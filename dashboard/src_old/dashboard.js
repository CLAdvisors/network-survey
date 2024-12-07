import React, { useState, useCallback, useRef } from 'react';
import './dashboard.css';
import TabularDataComponent from './TabularDataComponent.js';
import NameStatusIcon from './NameStatusIcon';
import QuestionStatusIcon from './QuestionStatusIcon';
import Graph from './Graph';
import Papa from 'papaparse';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import 'react-tabs/style/react-tabs.css';

// TODO for MVP
// - Redo the UI
// - Change survey results download to csv
// - Change name download to csv
// - Questions upload download format?
// - Add authentication
// - make data table editable
// - remove old data table data when switching to a survey with no data

const Dashboard = () => {
  const questionFileInputRef = useRef(null);
  const userFileInputRef = useRef(null);
  const emailFileInputRef = useRef(null);

  const apiUrl = process.env.REACT_APP_API_URL;
  console.log('API URL:', apiUrl);
  const [activeSurvey, setActiveSurvey] = useState("");
  const [surveys, setSurveys] = useState([]);
  const [surveyName, setSurveyName] = useState("");
  const [statusUpdator, setStatusUpdator] = useState(0);

    // Use the endpoint http://localhost:3001/api/surveys to get a list of surveys
    // and update the surveys state variable with the result
    
    const updateActiveSurvey = useCallback((event) => {
      const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/surveys`;
        sendRequest(url, (data) => {
            setSurveys(data.surveys);
            if (data.surveys.length > 0 && activeSurvey === '') {
              setActiveSurvey(data.surveys[0]);
            }
        });
    }, [activeSurvey]);
    
    React.useEffect(() => {
        updateActiveSurvey();
    }, [updateActiveSurvey]);

    const createSurvey = async () => {
      const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/survey`;
      const response = await postRequest(url, { surveyName: surveyName });
      console.log(response)
      if (response.status === 200) {
        setSurveys([...surveys, surveyName]);
      }
    };  
    
    const uploadContacts = event => {
      const reader = new FileReader();
      reader.onload = function(event) {

        const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/updateTargets`;
        postRequest(url, { surveyName: activeSurvey, csvData: event.target.result }, () => {
          userFileInputRef.current.value = '';
          setStatusUpdator(statusUpdator + 1);
        });
      };
      reader.readAsText(event.target.files[0]);

      
    }
    
    const uploadQuestions = event => {

      const reader = new FileReader();
      
      reader.onload = function(event) {
        const data = event.target.result;

        const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/updateQuestions`;
        postRequest(url, { surveyName: activeSurvey, surveyQuestions: data}, () => {
          questionFileInputRef.current.value = '';
          setStatusUpdator(statusUpdator + 1);
        });
      };

      reader.readAsText(event.target.files[0]);

      
    }

    const uploadEmails = event => {

      const reader = new FileReader();
      
      reader.onload = function(event) {
        const data = event.target.result;

        const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/updateEmails`;
        postRequest(url, { surveyName: activeSurvey, csvData: data}, () => {
          emailFileInputRef.current.value = '';
          setStatusUpdator(statusUpdator + 1);
        });
      };

      reader.readAsText(event.target.files[0]);

      
    }

    const sendSurvey = async () => {
      const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/startSurvey`;
      const response = await postRequest(url, { surveyName: activeSurvey });
      console.log(response);
    };

    function jsonToCsv(json) {
      // Create an array to hold the data rows
      let csvData = [];
  
      // Iterate over the responses in the JSON object
      for (let name in json.responses) {
          // Create a new object for this row
          let row = {
              "name": name,
              "timestamp": json.responses[name].timeStamp,
          };
          
          // Iterate over the questions in this response
          console.log(row)
          for (let question in json.responses[name]) {
              // Skip if it's the timestamp field
              if (question === "timeStamp") continue;
  
              // Add this question's answers to the row
              row[question] = json.responses[name][question].join(", ");
          }
  
          // Add this row to the csv data array
          csvData.push(row);
      }
      console.log(csvData)
      // Unparse the csv data array into a CSV string
      let csvString = Papa.unparse(csvData);
  
      return csvString;
  }

    const downloadAnswers = () => {
        const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/results?surveyName=${activeSurvey}`;
        sendRequest(url, (data) => {
          // convert JSON to CSV
          const csv = jsonToCsv(data);
          // create a blob object
          const dataBlob = new Blob([csv], { type: 'text/csv' });
          // const dataBlob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          const dataURL = window.URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = dataURL;
          link.setAttribute('download', `${activeSurvey}_results.csv`);
          document.body.appendChild(link); // Required for Firefox
          link.click();
          document.body.removeChild(link); // Required for Firefox
        });
    }

    const testSurvey = () => {
      window.open(`http://network-survey-cla.s3-website-us-east-1.amazonaws.com/?surveyName=${activeSurvey}&userId=demo`);
    }

    function sendRequest(url, onloadSuccessCallback) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.onload = () => {
          if (xhr.status === 200 && xhr.response !== '') {
            onloadSuccessCallback(JSON.parse(xhr.response));
          }
        };
        xhr.send();
    }

    async function postRequest(url, data, onSuccess) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
    
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
    
        if (typeof onSuccess === 'function') {
          onSuccess(response);
        }
    
        return response;
      } catch (error) {
        console.error('Error:', error);
        throw error;
      }
    }    
    return (
        <div className="dashboard">
          <h1>Survey Dashboard</h1>
        <div className="row">
            <input 
            className="input"
            type="text" 
            placeholder="Enter Survey Name"
            value={surveyName}
            onChange={(e) => {
              setSurveyName(e.target.value);
            }}
            />
            <button className="button" onClick={createSurvey}>Submit New Survey</button>
        </div>
          <div className="row">
            <div className='templates'>
              <h3>Templates for creating surveys: </h3>
              <button className="button" onClick={createSurvey}>Download Survey File Template</button>
              <button className="button" onClick={createSurvey}>Download User File Template</button>
              <button className="button" onClick={createSurvey}>Download Email File Template</button>
            </div>
          </div>
          <div className="row">
          <h3> Selected Survey:</h3>
          <select className="dropdown" value={activeSurvey} onChange={e => setActiveSurvey(e.target.value)}>
            {surveys.map((survey, index) => (
                <option key={index} value={survey}>
                {survey}
                </option>
            ))}
            </select>
          </div>
          <div className="row">
          <Tabs>
          <TabList>
            <Tab>Survey Config</Tab>
            <Tab>Survey Table</Tab>
            <Tab>Survey Graph</Tab>
          </TabList>

          <TabPanel>
          <div className="row">
            {/* <StatusIcon text = {"Questions uploaded:"} mode = {activeSurvey}/> */}
            <QuestionStatusIcon activeSurvey = {activeSurvey} updateDummy={statusUpdator}/>
            <NameStatusIcon activeSurvey = {activeSurvey} updateDummy={statusUpdator}/>
            <label className="button">
            Upload Survey File
            <input type="file" onChange={uploadQuestions} style={{display: 'none'}} ref={questionFileInputRef} />
            </label>
            <label className="button">
            Upload Users
            <input type="file" onChange={uploadContacts} style={{display: 'none'}} ref={userFileInputRef} />
            </label>
            <label className="button">
            Upload Email Template
            <input type="file" onChange={uploadEmails} style={{display: 'none'}} ref={emailFileInputRef} />
            </label>
            </div>
            <div className="row">
            <div>
              <button className="button" onClick={testSurvey}>Demo Survey</button>
              <button className="button" onClick={downloadAnswers}>Download Answers</button>
            </div>
            </div>
            <div className="row">
            <h3>Start Survey (Be careful):</h3>
              <button className="button" onClick={sendSurvey}>Send Notifications</button>
            </div>
          </TabPanel>
          <TabPanel>
            <h2>User Data</h2>
          <div className="row">
            <TabularDataComponent activeSurvey={activeSurvey}/>
          </div>
          </TabPanel>
          <TabPanel>
          <div className="row">
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
          </div>
          </TabPanel>
        </Tabs>
        </div>
      </div> 
    );
}

export default Dashboard;
