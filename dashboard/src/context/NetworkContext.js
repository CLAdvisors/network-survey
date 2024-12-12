import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

const NetworkContext = createContext(null);

export const NetworkProvider = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const simulationRef = useRef(null);
  const nodesRef = useRef(null);
  const linksRef = useRef(null);
  const timeRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const frameTimesRef = useRef([]);
  const performanceScaleRef = useRef(1);
  const scaleTransitionRef = useRef(null);

  // Performance monitoring constants
  const FRAME_SAMPLE_SIZE = 60; // Number of frames to average
  const TARGET_FPS = 40; // Target minimum FPS
  const FRAME_TIME_THRESHOLD = 1000 / TARGET_FPS; // ~25ms per frame
  const SCALE_STEP = 0.1; // How much to adjust scale each time
  const MIN_SCALE = 0.3; // Minimum scale factor
  const SCALE_TRANSITION_DURATION = 1000; // ms

  const updatePerformanceScale = useCallback((currentTime) => {
    const frameTime = currentTime - lastFrameTimeRef.current;
    lastFrameTimeRef.current = currentTime;

    // Add frame time to rolling average
    frameTimesRef.current.push(frameTime);
    if (frameTimesRef.current.length > FRAME_SAMPLE_SIZE) {
      frameTimesRef.current.shift();
    }

    // Calculate average frame time
    const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;

    // Determine if we need to adjust scale
    if (avgFrameTime > FRAME_TIME_THRESHOLD && performanceScaleRef.current > MIN_SCALE) {
      // Performance is poor, reduce scale
      const newScale = Math.max(MIN_SCALE, performanceScaleRef.current - SCALE_STEP);
      if (newScale !== performanceScaleRef.current) {
        startScaleTransition(newScale);
      }
    }
  }, [FRAME_TIME_THRESHOLD]);

  const startScaleTransition = (targetScale) => {
    const startScale = performanceScaleRef.current;
    const startTime = performance.now();

    // Cancel any existing transition
    if (scaleTransitionRef.current) {
      cancelAnimationFrame(scaleTransitionRef.current);
    }

    const animateScale = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / SCALE_TRANSITION_DURATION, 1);
      
      // Use easeOutCubic for smooth transition
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      performanceScaleRef.current = startScale + (targetScale - startScale) * easeProgress;

      if (progress < 1) {
        scaleTransitionRef.current = requestAnimationFrame(animateScale);
      } else {
        scaleTransitionRef.current = null;
      }
    };

    scaleTransitionRef.current = requestAnimationFrame(animateScale);
  };

  const initializeSimulation = (width, height, theme) => {
    if (isInitialized) return;

    const isMobile = window.innerWidth < 768;

    const config = {
      nodeCount: isMobile ? 50 : 300,
      linkCount: isMobile ? 150 : 500,
      nodeSize: { 
        min: isMobile ? 1.5 : 2, 
        max: isMobile ? 4 : 6 
      },
      linkDistance: isMobile ? 40 : 60,
      linkStrengthRange: { min: 0.01, max: 1.4 },
      chargeStrength: isMobile ? -300 : -500,
      velocityDecay: 0.2,
      speedFactor: 0.8,
      orbitForce: isMobile ? 0.12 : 0.045,
      centralForce: isMobile ? 0.65 : 0.6,
      orbitSpeedRange: { min: 0.0002, max: 0.0008 },
      orbitRadiusRanges: [
        { min: 0.15, max: 0.25 },
        { min: 0.35, max: 0.45 },
        { min: 0.55, max: 0.65 }
      ],
      oscillationPeriod: 20000,
      oscillationMagnitude: isMobile ? 15 : 25
    };

    const centerX = width / 2;
    const centerY = height / 2;

    const getRandomOrbitRadius = () => {
      const range = config.orbitRadiusRanges[
        Math.floor(Math.random() * config.orbitRadiusRanges.length)
      ];
      const minRadius = range.min * Math.min(width, height);
      const maxRadius = range.max * Math.min(width, height);
      return minRadius + Math.random() * (maxRadius - minRadius);
    };

    // Initialize nodes
    nodesRef.current = Array.from({ length: config.nodeCount }, () => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.min(width, height) * 0.3;
      
      return {
        radius: Math.random() * (config.nodeSize.max - config.nodeSize.min) + config.nodeSize.min,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitSpeed: (Math.random() * 
          (config.orbitSpeedRange.max - config.orbitSpeedRange.min) + 
          config.orbitSpeedRange.min) * 
          (Math.random() < 0.5 ? 1 : -1),
        orbitRadius: getRandomOrbitRadius(),
        oscillationPhase: Math.random() * Math.PI * 2,
        forceMultiplier: Math.random() * 0.3 + 0.85
      };
    });

    // Initialize links with stronger forces
    linksRef.current = Array.from({ length: config.linkCount }, () => {
      const sourceIndex = Math.floor(Math.random() * config.nodeCount);
      let targetIndex;
      do {
        targetIndex = Math.floor(Math.random() * config.nodeCount);
      } while (targetIndex === sourceIndex); // Prevent self-links

      return {
        source: sourceIndex,
        target: targetIndex,
        strength: Math.random() * 
          (config.linkStrengthRange.max - config.linkStrengthRange.min) + 
          config.linkStrengthRange.min,
      };
    });

    // Custom combined force
    const combinedForce = (alpha) => {
      const scaledAlpha = alpha * config.speedFactor;
      
      nodesRef.current.forEach(node => {
        // Scale all forces by performance scale
        const scale = performanceScaleRef.current;
        node.orbitAngle += node.orbitSpeed * config.speedFactor;
        
        const targetX = centerX + Math.cos(node.orbitAngle) * node.orbitRadius * scale;
        const targetY = centerY + Math.sin(node.orbitAngle) * node.orbitRadius * scale;
        
        const oscillation = Math.sin(
          (timeRef.current / config.oscillationPeriod) * Math.PI * 2 + node.oscillationPhase
        ) * config.oscillationMagnitude * scale;
        
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        const orbitStrength = config.orbitForce * node.forceMultiplier * config.speedFactor * scale;
        node.vx += (targetX - node.x) * orbitStrength * scaledAlpha;
        node.vy += (targetY - node.y) * orbitStrength * scaledAlpha;
        
        const gravityScale = (distanceFromCenter / (Math.min(width, height) * 0.5)) * scale;
        const centralStrength = config.centralForce * gravityScale * config.speedFactor;
        node.vx += dx * centralStrength * scaledAlpha;
        node.vy += dy * centralStrength * scaledAlpha;
        
        const oscillationForce = oscillation * scaledAlpha * node.forceMultiplier;
        node.vx += Math.cos(node.orbitAngle) * oscillationForce * config.speedFactor * scale;
        node.vy += Math.sin(node.orbitAngle) * oscillationForce * config.speedFactor * scale;
      });

      // Monitor performance
      updatePerformanceScale(performance.now());
    };

    // Initialize simulation with performance-aware forces
    simulationRef.current = d3.forceSimulation(nodesRef.current)
      .force("link", d3.forceLink(linksRef.current)
        .id(d => d.index)
        .distance(d => config.linkDistance * performanceScaleRef.current)
        .strength(d => d.strength * 1.5))
      .force("charge", d3.forceManyBody()
        .strength(d => config.chargeStrength * d.forceMultiplier * performanceScaleRef.current)
        .distanceMin(5 * performanceScaleRef.current)
        .distanceMax(width * 0.5 * performanceScaleRef.current))
      .force("collision", d3.forceCollide()
        .radius(d => d.radius * 2 * performanceScaleRef.current)
        .strength(0.9))
      .force("combined", combinedForce)
      .velocityDecay(config.velocityDecay)
      .alphaMin(0.001)
      .alphaTarget(0.01)
      .alpha(0.3);

    // Update time reference with performance monitoring
    const updateTime = () => {
      timeRef.current = Date.now();
      simulationRef.current.restart();
      requestAnimationFrame(updateTime);
    };
    requestAnimationFrame(updateTime);

    setIsInitialized(true);
  };

  const value = {
    simulationRef,
    nodesRef,
    linksRef,
    initializeSimulation,
    isInitialized,
    performanceScale: performanceScaleRef.current
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