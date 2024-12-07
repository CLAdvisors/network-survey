import React from 'react';
import Typography from '@mui/material/Typography';
import { Box } from '@mui/material';
import Graph from './Graph';

const Results = () => {
  return (
    <Box sx={{ padding: '20px' }}>
    <Typography variant="h6" color="text.primary">
      Results will be displayed here...
    </Typography>
    <Typography variant="h5" color="text.primary">
      Graph demo
    </Typography>
    <Graph vertexSet={[
          {id: '1', label: 'Vertex 1'},
          {id: '2', label: 'Vertex 2'},
          {id: '3', label: 'Vertex 3'},
          {id: '4', label: 'Vertex 4'},
          {id: '5', label: 'Vertex 5'},
          {id: '6', label: 'Vertex 6'},
          {id: '7', label: 'Vertex 7'},
        ]} edgeSet={[
          {source: '1', target: '2', label: 'Edge 1-2'},
          {source: '1', target: '3', label: 'Edge 1-3'},
          {source: '2', target: '4', label: 'Edge 2-4'},
          {source: '3', target: '5', label: 'Edge 3-5'},
          {source: '4', target: '5', label: 'Edge 4-5'},
          {source: '6', target: '7', label: 'Edge 6-7'},
          {source: '2', target: '7', label: 'Edge 2-7'},
          {source: '2', target: '5', label: 'Edge 2-5'}
        ]}></Graph>
    </Box>
  );
};

export default Results;
