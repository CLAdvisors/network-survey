import React, {useState} from 'react';
import StatusIcon from './StatusIcon'; 


const QuestionStatusIcon = ({ activeSurvey }) => {
    const [status, setStatus] = useState("icon_red");

    React.useEffect(() => { 
        if (activeSurvey === '') {
            return;
        }
        const url = `http://localhost:3000/api/surveyStatus?surveyName=${activeSurvey}`;
        sendRequest(url, (data) => {
            if(data.questionDataStatus)
                setStatus('icon_green');
            else
                setStatus('icon_red');

            
        });
    }, [activeSurvey, status]);


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
        <div>
            <StatusIcon text = {"Questions uploaded:"} mode = {status}/>
        </div>
    );
};

export default QuestionStatusIcon;