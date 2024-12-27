import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useTheme } from '@mui/material/styles';

const NetworkGraph = ({ 
  data,
  selectedRespondent,
  onNodeClick,
  width = 800,
  height = 600,
  showAllUsers = false
}) => {
  const svgRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const transformRef = useRef(null);
  const theme = useTheme();
  
  useEffect(() => {
    if (!data || !data.responses) return;
    
    const nodesMap = new Map();
    const linksArray = [];
    
    // Add all respondents
    Object.entries(data.responses).forEach(([respondent]) => {
      nodesMap.set(respondent, { 
        id: respondent, 
        degree: 0,
        isRespondent: true
      });
    });

    // Add all nominations and create links
    Object.entries(data.responses).forEach(([respondent, answers]) => {
      Object.entries(answers).forEach(([question, recipients]) => {
        if (question === 'timeStamp') return;
        
        recipients.forEach(recipient => {
          const recipientName = recipient.split(' (')[0];
          
          if (!nodesMap.has(recipientName)) {
            nodesMap.set(recipientName, { 
              id: recipientName, 
              degree: 0,
              isRespondent: false 
            });
          }
          
          linksArray.push({
            source: respondent,
            target: recipientName,
            question: question
          });
          
          nodesMap.get(respondent).degree++;
          nodesMap.get(recipientName).degree++;
        });
      });
    });

    // Add remaining users if showAllUsers is true
    if (showAllUsers && data.users) {
      data.users.forEach(user => {
        if (!nodesMap.has(user.name)) {
          nodesMap.set(user.name, { 
            id: user.name, 
            degree: 2,
            isRespondent: user.isRespondent,
            isNonParticipant: true
          });
        }
      });
    }

    const filteredNodesMap = new Map(
      Array.from(nodesMap.entries()).filter(([_, node]) => 
        showAllUsers || !node.isNonParticipant
      )
    );

    setNodes(Array.from(filteredNodesMap.values()));
    setLinks(linksArray);
  }, [data, showAllUsers]);

  useEffect(() => {
    if (!nodes.length) return;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const container = svg.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.5, 5])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        container.attr("transform", event.transform);
      });

    svg.call(zoom);

    const defs = svg.append("defs");

    // Create arrow markers for each possible question
    const questions = [...new Set(links.map(link => link.question))];
    const questionColorScale = d3.scaleOrdinal()
      .domain(questions)
      .range(d3.schemeTableau10);

    questions.forEach(question => {
      const color = questionColorScale(question);
      defs.append("marker")
        .attr("id", `arrow-${question}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 4)
        .attr("markerHeight", 4)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color);
    });

    const nodeDegrees = new Map();
    links.forEach(link => {
      nodeDegrees.set(link.source.id || link.source, (nodeDegrees.get(link.source.id || link.source) || 0) + 1);
      nodeDegrees.set(link.target.id || link.target, (nodeDegrees.get(link.target.id || link.target) || 0) + 1);
    });

    const maxDegree = Math.max(...nodeDegrees.values());
    
    const intensityScale = d3.scaleLinear()
      .domain([0, maxDegree])
      .range([0.5, 1]);

    const colorScale = d3.scaleLinear()
      .domain([0, maxDegree])
      .range([
        d3.color(theme.palette.primary.light).darker(-0.5),
        d3.color(theme.palette.primary.main).darker(0.5)
      ]);

    const sizeScale = d3.scaleSqrt()
      .domain([0, maxDegree])
      .range([5, 12]);

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

    const padding = 50;

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(50))
      .force("charge", d3.forceManyBody().strength(-100))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.1))
      .force("collision", d3.forceCollide().radius(d => sizeScale(nodeDegrees.get(d.id)) * 1.5))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    const link = container.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .style("stroke", d => questionColorScale(d.question))
      .style("stroke-width", 0.4)
      .style("opacity", 0.2);

    const nodeGroup = container.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g");

    nodeGroup.append("circle")
      .attr("r", d => sizeScale(nodeDegrees.get(d.id) ? nodeDegrees.get(d.id) : 0))
      .style("fill", d => `url(#node-gradient-${nodeDegrees.get(d.id) ? nodeDegrees.get(d.id) : 1})`) 
      .style("stroke", d => colorScale(nodeDegrees.get(d.id)))
      .style("stroke-width", 0.3)
      .style("stroke-opacity", d => {
        const baseOpacity = intensityScale(nodeDegrees.get(d.id)) * 0.5;
        return d.isNonParticipant ? baseOpacity * 0.8 : baseOpacity;
      })
      .style("opacity", d => d.isNonParticipant ? 0.8 : 1);

    nodeGroup.append("circle")
      .attr("r", d => sizeScale(nodeDegrees.get(d.id) ? nodeDegrees.get(d.id) : 0) * 1.3)
      .style("fill", "none")
      .style("stroke", d => colorScale(nodeDegrees.get(d.id)))
      .style("stroke-width", 0.3)
      .style("stroke-opacity", d => {
        const baseOpacity = intensityScale(nodeDegrees.get(d.id)) * 0.2;
        return d.isNonParticipant ? baseOpacity * 0.3 : baseOpacity;
      });

    nodeGroup.append("circle")
      .attr("r", d => sizeScale(nodeDegrees.get(d.id) ? nodeDegrees.get(d.id) : 0) * 1.5)
      .style("fill", "none")
      .style("stroke", theme.palette.primary.main)
      .style("stroke-width", 1.2)
      .style("stroke-opacity", 0)
      .classed("selection-highlight", true);

    const label = container.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text(d => d.id)
      .attr("font-size", "8px")
      .attr("fill", theme.palette.text.primary)
      .attr("dx", d => sizeScale(nodeDegrees.get(d.id) ? nodeDegrees.get(d.id) : 0) + 2)
      .attr("dy", "0.35em")
      .style("pointer-events", "none")
      .style("opacity", d => d.isNonParticipant ? 0.3 : 0.7);

    const highlightNode = (nodeId, highlight = true) => {
      nodeGroup.selectAll("circle.selection-highlight")
        .style("stroke-opacity", d => d.id === nodeId && highlight ? 0.8 : 0);

      link
        .style("opacity", l => {
          if (!highlight) return 0.2;
          return (l.source.id === nodeId || l.target.id === nodeId) ? 0.8 : 0.1;
        })
        .style("stroke-width", l => {
          if (!highlight) return 0.4;
          return (l.source.id === nodeId || l.target.id === nodeId) ? 0.8 : 0.4;
        })
        .attr("marker-end", l => {
          if (!highlight) return null;
          return (l.source.id === nodeId || l.target.id === nodeId) ? 
            `url(#arrow-${l.question})` : null;
        });

      label.style("opacity", text => 
        !highlight ? 0.7 : (text.id === nodeId ? 1 : 0.3)
      );
    };

    nodeGroup.on("mouseover", (event, d) => highlightNode(d.id))
      .on("mouseout", () => {
        if (selectedRespondent) {
          highlightNode(selectedRespondent);
        } else {
          highlightNode(null, false);
        }
      })
      .on("click", (event, d) => {
        if (onNodeClick) onNodeClick(d.id);
      });

    nodeGroup.call(d3.drag()
      .on("start", (event) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }));

    simulation.on("tick", () => {
      nodes.forEach(d => {
        d.x = Math.max(padding, Math.min(width - padding, d.x));
        d.y = Math.max(padding, Math.min(height - padding, d.y));
      });

      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      nodeGroup
        .attr("transform", d => `translate(${d.x},${d.y})`);

      label
        .attr("x", d => d.x)
        .attr("y", d => d.y);
    });

    // Apply stored transform after container is created
    if (transformRef.current && !selectedRespondent) {
      svg.transition()
        .duration(300)
        .call(zoom.transform, transformRef.current);
    }

    // Handle selected respondent zoom after container is created
    if (selectedRespondent) {
      const selectedNode = nodes.find(n => n.id === selectedRespondent);
      if (selectedNode) {
        const scale = 2;
        const translate = [
          width / 2 - scale * selectedNode.x,
          height / 2 - scale * selectedNode.y
        ];
        
        const newTransform = d3.zoomIdentity
          .translate(translate[0], translate[1])
          .scale(scale);
        
        transformRef.current = newTransform;
        
        svg.transition()
          .duration(750)
          .call(zoom.transform, newTransform);

        highlightNode(selectedRespondent);
      }
    }

    return () => simulation.stop();
  }, [nodes, links, width, height, selectedRespondent, onNodeClick, theme]);

  return (
    <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
  );
};

export default NetworkGraph;