import React from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import "./index.css";
// import { json } from "./json";

function SurveyComponent({setTitle}) {
    const searchParams = new URLSearchParams(window.location.search);
    const userId = searchParams.get("userId"); 
    const surveyName = searchParams.get("surveyName"); 

    console.log(userId, surveyName);

    // Get survey question json from questions api
    const [json, setJson] = React.useState(null);
    React.useEffect(() => {
      const url = `http://localhost:3000/api/questions?surveyName=${surveyName}`;
      sendRequest(url, (data) => { setJson(data.questions); setTitle(data.title); });
    }, [surveyName]);
    
    
    if (!userId || !surveyName) {
      return <h1>Invalid URL, please use the unique url provided by email.</h1>
    }

    const survey = new Model(json);

    survey.onComplete.add((sender, options) => {
        let data = JSON.stringify(sender.data, null, 3);
        let url = 'http://localhost:3000/api/user'

        if (userId === 'demo') {
          return;
        }
        
        postRequest(url, {userId: userId, surveyName: surveyName, answers: data})

    });

    survey.onChoicesLazyLoad.add((_, options) => {
        console.log("YES IT WENT HERE")
        const url = `http://localhost:3000/api/names?skip=${options.skip}&take=${options.take}&filter=${options.filter}&surveyName=${surveyName}`;
        sendRequest(url, (data) => { options.setItems(data.names, data.total); });
    });
    
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
      
          const jsonResponse = await response.json();
          return jsonResponse;
        } catch (error) {
          console.error('Error:', error);
          throw error;
        }
    }
    return (json != null ?
      <Survey model={survey} /> : <div></div>
    );
}

export default SurveyComponent;