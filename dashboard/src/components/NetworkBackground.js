import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useTheme } from '@mui/material/styles';
import { useNetwork } from '../context/NetworkContext';

const useViewportSize = () => {
  const getSize = () => {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const scaleFactor = window.innerWidth < 768 ? 2 : 1.5;
    return {
      width: vw * scaleFactor,
      height: vh * scaleFactor
    };
  };

  const [size, setSize] = useState(getSize());

  useEffect(() => {
    const handleResize = () => {
      setSize(getSize());
    };

    window.addEventListener('resize', handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  return size;
};

const NetworkBackground = () => {
  const svgRef = useRef(null);
  const theme = useTheme();
  const { simulationRef, nodesRef, linksRef, initializeSimulation, isInitialized } = useNetwork();
  const visualsRef = useRef(null);
  const viewportSize = useViewportSize();

  useEffect(() => {
    const width = viewportSize.width;
    const height = viewportSize.height;
    
    if (!svgRef.current) return;

    // Initialize or update SVG dimensions
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    if (!isInitialized) {
      initializeSimulation(width, height, theme);
      d3.select(svgRef.current).selectAll("*").remove();
    } else {
      // Update simulation center force
      simulationRef.current
        .force("center", d3.forceCenter(width / 2, height / 2))
        .alpha(0.3) // Restart simulation with reduced intensity
        .restart();
    }

    // Calculate node degrees
    const nodeDegrees = new Map();
    linksRef.current.forEach(link => {
      nodeDegrees.set(link.source, (nodeDegrees.get(link.source) || 0) + 1);
      nodeDegrees.set(link.target, (nodeDegrees.get(link.target) || 0) + 1);
    });

    const maxDegree = Math.max(...nodeDegrees.values());
    
    const intensityScale = d3.scaleLinear()
      .domain([0, maxDegree])
      .range([0.2, 1]);

    const colorScale = d3.scaleLinear()
      .domain([0, maxDegree])
      .range([
        d3.color(theme.palette.primary.light).darker(-0.5),
        d3.color(theme.palette.primary.main).darker(0.5)
      ]);

    const sizeScale = d3.scaleSqrt()
      .domain([0, maxDegree])
      .range([2, 12]);

    if (!visualsRef.current) {
      const defs = svg.append("defs");

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
        .style("stroke-width", 0.8)
        .style("opacity", 0.12);

      const node = visualsRef.current.append("g")
        .selectAll("g")
        .data(nodesRef.current)
        .join("g");

      node.append("circle")
        .attr("r", d => sizeScale(nodeDegrees.get(d) || 0))
        .style("fill", d => `url(#node-gradient-${nodeDegrees.get(d) || 0})`)
        .style("stroke", d => colorScale(nodeDegrees.get(d) || 0))
        .style("stroke-width", 0.3)
        .style("stroke-opacity", d => intensityScale(nodeDegrees.get(d) || 0) * 0.5);

      node.append("circle")
        .attr("r", d => sizeScale(nodeDegrees.get(d) || 0) * 1.3)
        .style("fill", "none")
        .style("stroke", d => colorScale(nodeDegrees.get(d) || 0))
        .style("stroke-width", 0.3)
        .style("stroke-opacity", d => intensityScale(nodeDegrees.get(d) || 0) * 0.2);

      const updatePositions = () => {
        const padding = 50;

        nodesRef.current.forEach(node => {
          node.x = Math.max(padding, Math.min(width - padding, node.x));
          node.y = Math.max(padding, Math.min(height - padding, node.y));
        });

        link
          .attr("x1", d => d.source.x)
          .attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x)
          .attr("y2", d => d.target.y);

        node
          .attr("transform", d => `translate(${d.x},${d.y})`);
      };

      simulationRef.current
        .force("collision", d3.forceCollide()
          .radius(d => sizeScale(nodeDegrees.get(d) || 0) * 1.4)
          .strength(0.9))
        .on("tick", updatePositions);
    }

  }, [theme, initializeSimulation, isInitialized, linksRef, nodesRef, simulationRef, viewportSize]);

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