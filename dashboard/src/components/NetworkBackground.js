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
    // Larger scale for mobile
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

    const defs = svg.append("defs");
    const linkGradient = defs.append("linearGradient")
      .attr("id", `linkGradient-${Math.random()}`)
      .attr("gradientUnits", "userSpaceOnUse");

    linkGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", theme.palette.primary.light)
      .attr("stop-opacity", 0.2);

    linkGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", theme.palette.primary.main)
      .attr("stop-opacity", 0.4);

    visualsRef.current = svg.append("g");

    const link = visualsRef.current.append("g")
      .selectAll("line")
      .data(linksRef.current)
      .join("line")
      .style("stroke", `url(#${linkGradient.attr("id")})`)
      .style("stroke-width", 0.5)
      .style("opacity", 0.6);

    const node = visualsRef.current.append("g")
      .selectAll("circle")
      .data(nodesRef.current)
      .join("circle")
      .attr("r", d => d.radius)
      .style("fill", theme.palette.primary.main)
      .style("opacity", 0.4);

    node.append("circle")
      .attr("r", d => d.radius * 1.2)
      .style("fill", "none")
      .style("stroke", theme.palette.primary.light)
      .style("stroke-width", 0.5)
      .style("opacity", 0.2);

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
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);
    };

    simulationRef.current.on("tick", updatePositions);

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

  // Use larger offset for mobile
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