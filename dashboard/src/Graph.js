import React, { useEffect, useRef } from 'react';
import { select, forceLink, forceManyBody, forceCenter, forceSimulation, drag } from 'd3';

const Graph = ({ vertexSet, edgeSet }) => {
  const svgRef = useRef();
  const wrapperRef = useRef();

  const dragHandler = (simulation) => {
    const started = (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    };

    const dragged = (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    };

    const ended = (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    };

    return drag()
      .on("start", started)
      .on("drag", dragged)
      .on("end", ended);
  };

  useEffect(() => {
    const svg = select(svgRef.current);
    const wrapper = select(wrapperRef.current);

    // Get width and height of the wrapper
    const width = wrapper.node().getBoundingClientRect().width;
    const height = wrapper.node().getBoundingClientRect().height;

    svg.attr("width", width).attr("height", height);

    // clear svg before draw
    svg.selectAll("*").remove();

    const simulation = forceSimulation(vertexSet)
      .force("link", forceLink(edgeSet).id(d => d.id).distance(75)) // Increase distance between linked nodes
      .force("charge", forceManyBody().strength(-40))  // Increase repulsion
      .force("center", forceCenter(width / 2, height / 2));

    const link = svg.append("g")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(edgeSet)
      .join("line")
      .attr("stroke-width", d => Math.sqrt(d.value));

    link.append("title")
      .text(d => d.label);

    const node = svg.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("circle")
      .data(vertexSet)
      .join("circle")
      .attr("r", 10)
      .attr("fill", "#69b3a2")
      .call(dragHandler(simulation));

    node.append("title")
      .text(d => d.label);

    const labels = svg.append("g")
      .selectAll("text")
      .data(vertexSet)
      .join("text")
      .style("font-size", "10px")  // Smaller font size
      .text(d => d.label)
      .attr("x", d => d.x + 6)
      .attr("y", d => d.y + 6)
      .attr("dy", "0.35em");

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      labels
        .attr("x", d => d.x)
        .attr("y", d => d.y);
    });

  }, [vertexSet, edgeSet]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '200px' }}>
      <svg ref={svgRef} />
    </div>
  );
};

export default Graph;
