import React from 'react';

// Defined based on ag-grid button/Reactjs example
const cellButton = ({ value, clicked }) => {
  const btnClickedHandler = () => {
    clicked(value);
  };

  return (
    <button onClick={btnClickedHandler}>Send reminder!</button>
  );
};

export default cellButton;