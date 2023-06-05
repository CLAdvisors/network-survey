import React, {useState} from 'react';
import StatusIcon from './StatusIcon'; 


const NameStatusIcon = ({ activeSurvey }) => {
    const [status, setStatus] = useState("icon_red");

    React.useEffect(() => { 
        if (activeSurvey === '') {
            return;
        }
        const url = `http://localhost:3000/api/surveyStatus?surveyName=${activeSurvey}`;
        sendRequest(url, (data) => {
            if(data.userDataStatus)
                setStatus('icon_green');
            else
                setStatus('icon_red');

            
        });
    }, [activeSurvey, status]);

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
        <div>
            <StatusIcon text = {"Users uploaded:"} mode = {status}/>
        </div>
    );
};

export default NameStatusIcon;