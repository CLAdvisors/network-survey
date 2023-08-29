import React from 'react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import { ReactComponent as Logo } from './logo.svg';
import './Survey.css';

const Survey = () => {

    const [title, setTitle] = React.useState("");

    return (
        <div>
            <Header svgComponent={<Logo />} title={title} />
            <div className='instructions'>
                <h3>Survey Instructions </h3>
                <p>For each question below, indicate the people you interact with at work. The survey will take 10-15 minutes to complete; please plan to finish in one session.</p>
            </div>
            <SurveyComponent setTitle={setTitle}/>
        </div>
        
    );
};

export default Survey;