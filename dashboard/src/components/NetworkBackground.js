import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useTheme } from '@mui/material/styles';
import { useNetwork } from '../context/NetworkContext';

const NetworkBackground = () => {
  const svgRef = useRef(null);
  const theme = useTheme();
  const { simulationRef, nodesRef, linksRef, initializeSimulation, isInitialized } = useNetwork();
  const visualsRef = useRef(null);

  const getViewportSize = () => {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const scaleFactor = window.innerWidth < 768 ? 2 : 1.5;
    return {
      width: vw * scaleFactor,
      height: vh * scaleFactor
    };
  };

  useEffect(() => {
    const { width, height } = getViewportSize();
    initializeSimulation(width, height, theme);

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Calculate node degrees
    const nodeDegrees = new Map();
    linksRef.current.forEach(link => {
      nodeDegrees.set(link.source, (nodeDegrees.get(link.source) || 0) + 1);
      nodeDegrees.set(link.target, (nodeDegrees.get(link.target) || 0) + 1);
    });

    const maxDegree = Math.max(...nodeDegrees.values());
    
    // Create scales
    const intensityScale = d3.scaleLinear()
      .domain([0, maxDegree])
      .range([0.2, 1]);

    const colorScale = d3.scaleLinear()
      .domain([0, maxDegree])
      .range([
        d3.color(theme.palette.primary.light).darker(-0.5),
        d3.color(theme.palette.primary.main).darker(0.5)
      ]);

    // Reduced maximum node size
    const sizeScale = d3.scaleSqrt()
      .domain([0, maxDegree])
      .range([2, 12]); // Reduced from [2, 12] to [1.5, 6]

    const defs = svg.append("defs");

    // Create gradients considering node sizes
    Array.from(new Set(nodeDegrees.values())).forEach(degree => {
      const baseColor = colorScale(degree);
      const gradient = defs.append("radialGradient")
        .attr("id", `node-gradient-${degree}`);

      gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", baseColor)
        .attr("stop-opacity", intensityScale(degree));

      gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", baseColor)
        .attr("stop-opacity", intensityScale(degree) * 0.3);
    });

    visualsRef.current = svg.append("g");

    const link = visualsRef.current.append("g")
      .selectAll("line")
      .data(linksRef.current)
      .join("line")
      .style("stroke", theme.palette.primary.main)
      .style("stroke-width", 0.8) // Reduced from 0.5 to match smaller nodes
      .style("opacity", 0.25);

    const node = visualsRef.current.append("g")
      .selectAll("g")
      .data(nodesRef.current)
      .join("g");

    // Main node circle
    node.append("circle")
      .attr("r", d => sizeScale(nodeDegrees.get(d) || 0))
      .style("fill", d => `url(#node-gradient-${nodeDegrees.get(d) || 0})`)
      .style("stroke", d => colorScale(nodeDegrees.get(d) || 0))
      .style("stroke-width", 0.3) // Reduced from 0.5
      .style("stroke-opacity", d => intensityScale(nodeDegrees.get(d) || 0) * 0.5);

    // Outer glow with reduced size
    node.append("circle")
      .attr("r", d => sizeScale(nodeDegrees.get(d) || 0) * 1.3) // Reduced multiplier from 1.4
      .style("fill", "none")
      .style("stroke", d => colorScale(nodeDegrees.get(d) || 0))
      .style("stroke-width", 0.3) // Reduced from 0.5
      .style("stroke-opacity", d => intensityScale(nodeDegrees.get(d) || 0) * 0.2);

    const updatePositions = () => {
      const { width: currentWidth, height: currentHeight } = getViewportSize();
      const padding = 50;

      nodesRef.current.forEach(node => {
        node.x = Math.max(padding, Math.min(currentWidth - padding, node.x));
        node.y = Math.max(padding, Math.min(currentHeight - padding, node.y));
      });

      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("transform", d => `translate(${d.x},${d.y})`);
    };

    // Update collision radius for smaller nodes
    simulationRef.current
      .force("collision", d3.forceCollide()
        .radius(d => sizeScale(nodeDegrees.get(d) || 0) * 1.4) // Reduced multiplier from 1.5
        .strength(0.9))
      .on("tick", updatePositions);

    const handleResize = () => {
      const { width: newWidth, height: newHeight } = getViewportSize();
      
      svg
        .attr("width", newWidth)
        .attr("height", newHeight);
      
      simulationRef.current
        .force("center", d3.forceCenter(newWidth / 2, newHeight / 2))
        .restart();
    };

    window.addEventListener("resize", handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleResize);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleResize);
      }
    };
  }, [theme, initializeSimulation, isInitialized, linksRef, nodesRef, simulationRef]);

  

  const offset = window.innerWidth < 768 ? '-50%' : '-25%';

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'fixed',
        top: offset,
        left: offset,
        width: window.innerWidth < 768 ? '200%' : '150%',
        height: window.innerWidth < 768 ? '200%' : '150%',
        zIndex: 1,
        backgroundColor: theme.palette.background.default,
        opacity: 0.8,
        pointerEvents: 'none',
      }}
    />
  );
};

export default NetworkBackground;