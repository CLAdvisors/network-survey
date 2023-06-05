import React, { useState } from 'react';
import { AgGridReact } from 'ag-grid-react';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import cellButton from './cellButton';

const TabularDataComponent = ({ activeSurvey }) => {

    const [columnDefs] = useState([
        {
            field: 'reminder',
            cellRenderer: cellButton,
            cellRendererParams: {
              clicked: function(field = 'reminder') {
                alert(`${field} was clicked`);
              },
            },
        },
        { field: 'userName', sortable: true },
        { field: 'Email', sortable: true },
        { field: 'started', sortable: true },
        { field: 'status', sortable: true }
    ]);

   const [rowData, setRowData] = useState([]);

    React.useEffect(() => { 
        if (activeSurvey === '') {
            return;
        }
        console.log(activeSurvey)
        const url = "http://localhost:3000/api/targets?surveyName=" + activeSurvey;
        // try to send the request, if it fails delete old data
        sendRequest(url, (data) => {
            setRowData(data);
        }, (err) => {
            setRowData([]);
        });
    }, [activeSurvey]);
        
    function sendRequest(url, onloadSuccessCallback, onFailCallback) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.onload = () => {
          if (xhr.status === 200) {
            onloadSuccessCallback(JSON.parse(xhr.response));
          } else {
            onFailCallback(xhr.status);
          }
        };
        xhr.onerror = () => {
          onFailCallback(xhr.status);
        };
        xhr.send();
      }
      

   return (
       <div className="ag-theme-alpine" style={{height: 500, width: '100%',}}>
           <AgGridReact
               rowData={rowData}
               columnDefs={columnDefs}> 
           </AgGridReact>
       </div>
   );
};

export default TabularDataComponent;