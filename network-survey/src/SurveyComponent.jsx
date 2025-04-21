import React from "react";
import ReactDOM from "react-dom/client";
import { Model, Serializer, Question } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/defaultV2.min.css";
import "./survey.css";
import DraggableRankingQuestion from "./DraggableRankingQuestion";

// Define a custom Question class for draggableranking
class QuestionDraggableRankingModel extends Question {
  getType() {
    return "draggableranking";
  }
}

// Register custom question type for SurveyJS
Serializer.addClass(
  "draggableranking",
  [
    { name: "choices:itemvalues", default: [] }
  ],
  () => new QuestionDraggableRankingModel(""),
  "question"
);

function SurveyComponent({setTitle}) {
    const [json, setJson] = React.useState(null);
    const [survey, setSurvey] = React.useState(null);
    const searchParams = new URLSearchParams(window.location.search);
    const userId = searchParams.get("userId"); 
    const surveyName = searchParams.get("surveyName"); 

    React.useEffect(() => {
      if (!userId || !surveyName) return;
      
      const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/questions?surveyName=${surveyName}`;
      sendRequest(url, (data) => { 
        setJson(data.questions); 
        setTitle(data.title); 
      });
    }, [surveyName, setTitle, userId]);

    React.useEffect(() => {
      if (!json) return;

      const newSurvey = new Model(json);
      
      // Configure survey settings
      newSurvey.showQuestionNumbers = false;
      newSurvey.showProgressBar = "bottom";
      newSurvey.progressBarType = "questions";
      newSurvey.completedHtml  = "Thank you for completing the survey.";

      // Set modern theme
      Model.cssType = "defaultV2";
      
      // Survey event handlers
      newSurvey.onComplete.add((sender, options) => {
        if (userId === 'demo') return;
        let data = JSON.stringify(sender.data, null, 3);
        let url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/user`;
        postRequest(url, {userId: userId, surveyName: surveyName, answers: data});
      });

      newSurvey.onChoicesLazyLoad.add((_, options) => {
        const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/names?skip=${options.skip}&take=${options.take}&filter=${options.filter}&surveyName=${surveyName}&userId=${userId}`;
        sendRequest(url, (data) => { options.setItems(data.names, data.total); });
      });

      // Custom rendering for draggableranking
      newSurvey.onAfterRenderQuestion.add((survey, options) => {
        if (options.question.getType() === "draggableranking") {
          const container = document.createElement("div");
          options.htmlElement.innerHTML = "";
          options.htmlElement.appendChild(container);
          ReactDOM.createRoot(container).render(
            <DraggableRankingQuestion
              question={options.question}
              value={options.question.value || []}
              onChange={val => options.question.value = val}
            />
          );
        }
      });

      setSurvey(newSurvey);
    }, [json, userId, surveyName]);

    // API handlers
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

    if (!userId || !surveyName) {
      return <h1>Invalid URL, please use the unique url provided by email.</h1>;
    }

    if (!survey) {
      return <div></div>;
    }

    return (
      <div className="modern-survey-container">
        <Survey model={survey} />
      </div>
    );
}

export default SurveyComponent;