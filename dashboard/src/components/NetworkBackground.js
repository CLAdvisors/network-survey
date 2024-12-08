import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useTheme } from '@mui/material/styles';
import { useNetwork } from '../context/NetworkContext';

const NetworkBackground = () => {
  const svgRef = useRef(null);
  const theme = useTheme();
  const { simulationRef, nodesRef, linksRef, initializeSimulation, isInitialized } = useNetwork();
  const visualsRef = useRef(null);

  // Helper to get true viewport size
  const getViewportSize = () => {
    // Use visual viewport if available, otherwise use window dimensions
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    // Apply the 1.5x scale
    return {
      width: vw * 1.5,
      height: vh * 1.5
    };
  };

  useEffect(() => {
    const { width, height } = getViewportSize();

    // Initialize simulation if not already done
    initializeSimulation(width, height, theme);

    // Clear existing SVG content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Gradient for links
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
        // Use current viewport size for boundaries
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

    // Enhanced resize handler
    const handleResize = () => {
      const { width: newWidth, height: newHeight } = getViewportSize();
      
      svg
        .attr("width", newWidth)
        .attr("height", newHeight);
      
      simulationRef.current
        .force("center", d3.forceCenter(newWidth / 2, newHeight / 2))
        .restart();
    };

    // Listen to both window resize and visual viewport resize
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

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'fixed',
        top: '-25%',
        left: '-25%',
        width: '150%',
        height: '150%',
        zIndex: 1,
        backgroundColor: theme.palette.background.default,
        opacity: 0.8,
        pointerEvents: 'none',
      }}
    />
  );
};

export default NetworkBackground;