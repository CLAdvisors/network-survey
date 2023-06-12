import React, { useState, useCallback, useRef } from 'react';
import './dashboard.css';
import TabularDataComponent from './TabularDataComponent.js';
import NameStatusIcon from './NameStatusIcon';
import QuestionStatusIcon from './QuestionStatusIcon';
import TextInput from './TextInput';
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


  const [activeSurvey, setActiveSurvey] = useState("");
  const [surveys, setSurveys] = useState([]);
  const [surveyName, setSurveyName] = useState("");
  const [statusUpdator, setStatusUpdator] = useState(0);

    // Use the endpoint http://localhost:3001/api/surveys to get a list of surveys
    // and update the surveys state variable with the result
    
    const updateActiveSurvey = useCallback((event) => {
      const url = "http://localhost:3000/api/surveys";
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
      const url = "http://localhost:3000/api/survey";
      const response = await postRequest(url, { surveyName: surveyName });
    
      if (response.status === 200) {
        setSurveys([...surveys, surveyName]);
      }
    };
    
    const uploadContacts = event => {
      const reader = new FileReader();
      reader.onload = function(event) {

        const url = "http://localhost:3000/api/updateTargets";
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

        const url = "http://localhost:3000/api/updateQuestions";
        postRequest(url, { surveyName: activeSurvey, surveyQuestions: JSON.parse(event.target.result)}, () => {
          questionFileInputRef.current.value = '';
          setStatusUpdator(statusUpdator + 1);
        });
      };

      reader.readAsText(event.target.files[0]);

      
    }

    const downloadAnswers = () => {
        const url = `http://localhost:3000/api/results?surveyName=${activeSurvey}`;
        sendRequest(url, (data) => {
          const dataBlob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          const dataURL = window.URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = dataURL;
          link.setAttribute('download', `${activeSurvey}_results.json`);
          document.body.appendChild(link); // Required for Firefox
          link.click();
          document.body.removeChild(link); // Required for Firefox
        });
    }

    const testSurvey = () => {
      window.open(`http://localhost:3002/?surveyName=${activeSurvey}&userId=demo`);
    }

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
          <h2>Survey Config</h2>
        <div className="row">
          <div className='templates'>
            <h3>Templates for creating surveys: </h3>
            <button className="button" onClick={createSurvey}>Download Survey File Template</button>
            <button className="button" onClick={createSurvey}>Download User File Template</button>
          </div>
        </div>
        <div className="row">
            <select className="dropdown" value={activeSurvey} onChange={e => setActiveSurvey(e.target.value)}>
            {surveys.map((survey, index) => (
                <option key={index} value={survey}>
                {survey}
                </option>
            ))}
            </select>
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
            <button className="button" onClick={testSurvey}>Demo Survey</button>
            <button className="button" onClick={downloadAnswers}>Download Answers</button>
        </div>
        <h2>User Data</h2>
        <div className="row">
          <TabularDataComponent activeSurvey={activeSurvey}/>
        </div>
        <h2>Email Contents</h2>
        <div className="row">
          <TextInput activeSurvey={activeSurvey}/>
        </div>
        </div> 
    );
}

export default Dashboard;
