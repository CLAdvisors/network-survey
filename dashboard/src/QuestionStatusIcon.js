import React, {useState} from 'react';
import StatusIcon from './StatusIcon'; 


const QuestionStatusIcon = ({ activeSurvey, updateDummy }) => {
    const [status, setStatus] = useState("icon_red");

    React.useEffect(() => { 
        if (activeSurvey === '') {
            return;
        }
        console.log("Test", updateDummy)
        const url = `http://173.54.201.86:3000/api/surveyStatus?surveyName=${activeSurvey}`;
        sendRequest(url, (data) => {
            console.log("data: ", data)
            if(data.questionDataStatus){
              setStatus('icon_green');
            }
            else{
                setStatus('icon_red');
            }

            
        });
    }, [activeSurvey, updateDummy, status]);


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
            <StatusIcon text = {"Survey file uploaded:"} mode = {status}/>
        </div>
    );
};

export default QuestionStatusIcon;