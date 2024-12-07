import React, {useState} from 'react';
import StatusIcon from './StatusIcon'; 


const NameStatusIcon = ({ activeSurvey, updateDummy }) => {
    const [status, setStatus] = useState("icon_red");

    React.useEffect(() => { 
        if (activeSurvey === '') {
            return;
        }
        const url = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api/surveyStatus?surveyName=${activeSurvey}`;
        sendRequest(url, (data) => {
            if(data.userDataStatus)
                setStatus('icon_green');
            else
                setStatus('icon_red');

            
        });
    }, [activeSurvey, updateDummy, status]);

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

    return (
        <div>
            <StatusIcon text = {"Users uploaded:"} mode = {status}/>
        </div>
    );
};

export default NameStatusIcon;