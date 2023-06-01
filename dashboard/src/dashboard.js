import React, { useState, useCallback } from 'react';
import './dashboard.css';
import TabularDataComponent from './TabularDataComponent.js';


// TODO for MVP
// - Redo the UI
// - Change survey results download to csv
// - Change name download to csv
// - Questions upload download format?
// - Add authentication
// - make data table editable
// - remove old data table data when switching to a survey with no data

const Dashboard = () => {
  const [activeSurvey, setActiveSurvey] = useState("");
  const [surveys, setSurveys] = useState([]);
  const [surveyName, setSurveyName] = useState("");
  const [surveyQuestions, setSurveyQuestions] = useState(null);
  const [surveyTargets, setSurveyTargets] = useState(null);

    // Use the endpoint http://localhost:3001/api/surveys to get a list of surveys
    // and update the surveys state variable with the result
    
    const updateActiveSurvey = useCallback((event) => {
      const url = "http://localhost:3000/api/surveys";
        sendRequest(url, (data) => {
          console.log(data)
            setSurveys(data);
            if (data.length > 0 && activeSurvey === "") {
              setActiveSurvey(data[0]);
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
    
    const uploadQuestions = event => {
      const reader = new FileReader();
      reader.onload = function(event) {
        setSurveyQuestions(JSON.parse(event.target.result));
      };
      reader.readAsText(event.target.files[0]);

      const url = "http://localhost:3000/api/updateTargets";
      postRequest(url, { surveyName: surveyName, csvData: surveyTargets })
    }
    
    const uploadContacts = event => {
      const reader = new FileReader();
      reader.onload = function(event) {
        setSurveyTargets(event.target.result);
      };
      reader.readAsText(event.target.files[0]);

      const url = "http://localhost:3000/api/updateQuestions";
      postRequest(url, { surveyName: surveyName, surveyQuestions: surveyQuestions })
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

    async function postRequest(url, data) {
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
          return response;
        } catch (error) {
          console.error('Error:', error);
          throw error;
        }
    }

    return (
        <div className="dashboard">
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
            <button className="button" onClick={createSurvey}>Create New Survey</button>
        </div>
        <div className="row">
            <select className="dropdown" value={activeSurvey} onChange={e => setActiveSurvey(e.target.value)}>
            {surveys.map((survey, index) => (
                <option key={index} value={survey}>
                {survey}
                </option>
            ))}
            </select>
            <label className='icon_label'> Questions uploaded: <span className="icon_green">&#10003;</span></label>
            <label className='icon_label'>Users uploaded: <span className="icon_red">✖</span></label>
            <label className="button">
            Upload Questions
            <input type="file" onChange={uploadQuestions} style={{display: 'none'}} />
            </label>
            <label className="button">
            Upload Names
            <input type="file" onChange={uploadContacts} style={{display: 'none'}} />
            </label>
            <button className="button" onClick={downloadAnswers}>Download Answers</button>
        </div>
        <div className="row">
          <TabularDataComponent activeSurvey={activeSurvey}/>
        </div>
        </div> 
    );
}

export default Dashboard;
