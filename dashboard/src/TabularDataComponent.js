import React, { useState } from 'react';
import { AgGridReact } from 'ag-grid-react';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

const TabularDataComponent = ({ activeSurvey }) => {

    const [columnDefs] = useState([
        { field: 'userName' },
        { field: 'Email' },
        { field: 'started' },
        { field: 'status' }
    ]);

   const [rowData, setRowData] = useState([]);

    React.useEffect(() => { 
        if (activeSurvey === '') {
            return;
        }
        console.log(activeSurvey)
        const url = "http://localhost:3000/api/targets?surveyName=" + activeSurvey;
        sendRequest(url, (data) => {
            setRowData(data);
            console.log(data)
        });
    }, [activeSurvey]);
        
    function sendRequest(url, onloadSuccessCallback) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.onload = () => {
            if (xhr.status === 200) {
            onloadSuccessCallback(JSON.parse(xhr.response));
            }
        };
        xhr.send();
    }

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