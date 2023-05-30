import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgGridReact } from 'ag-grid-react';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

const TabularDataComponent = () => {
   const [rowData] = useState([
       {make: "Toyota", model: "Celica", price: 35000},
       {make: "Ford", model: "Mondeo", price: 32000},
       {make: "Porsche", model: "Boxster", price: 72000}
   ]);
   
   const [columnDefs] = useState([
       { field: 'Name' },
       { field: 'Email' },
       { field: 'Survey Started' },
       { field: 'Survey Completed' }
    
   ])

   return (
       <div className="ag-theme-alpine" style={{height: 400, width: 800,}}>
           <AgGridReact
               rowData={rowData}
               columnDefs={columnDefs}> 
           </AgGridReact>
       </div>
   );
};

export default TabularDataComponent;