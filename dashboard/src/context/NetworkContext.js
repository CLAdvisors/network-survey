import React, { createContext, useContext, useRef, useState } from 'react';
import * as d3 from 'd3';

const NetworkContext = createContext(null);

export const NetworkProvider = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const simulationRef = useRef(null);
  const nodesRef = useRef(null);
  const linksRef = useRef(null);

  const initializeSimulation = (width, height, theme) => {
    if (isInitialized) return;

    const config = {
      nodeCount: 200,
      linkCount: 300,
      nodeSize: { min: 2, max: 6 },
      linkDistance: 150,
      chargeStrength: -50,
      velocityDecay: 0.4,
      initialSpread: 0.45,
    };

    const centerX = width / 2;
    const centerY = height / 2;

    // Initialize nodes
    nodesRef.current = Array.from({ length: config.nodeCount }, () => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.min(width, height) * config.initialSpread;
      
      return {
        radius: Math.random() * (config.nodeSize.max - config.nodeSize.min) + config.nodeSize.min,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    // Initialize links
    linksRef.current = Array.from({ length: config.linkCount }, () => ({
      source: Math.floor(Math.random() * config.nodeCount),
      target: Math.floor(Math.random() * config.nodeCount),
      strength: Math.random() * 0.5 + 0.1,
    }));

    // Initialize simulation
    simulationRef.current = d3.forceSimulation(nodesRef.current)
      .force("link", d3.forceLink(linksRef.current)
        .distance(config.linkDistance)
        .strength(d => d.strength))
      .force("charge", d3.forceManyBody().strength(config.chargeStrength))
      .force("center", d3.forceCenter(centerX, centerY))
      .force("collision", d3.forceCollide().radius(d => d.radius * 1.5))
      .velocityDecay(config.velocityDecay)
      .alphaTarget(0.3);

    setIsInitialized(true);
  };

  const value = {
    simulationRef,
    nodesRef,
    linksRef,
    initializeSimulation,
    isInitialized
  };

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};