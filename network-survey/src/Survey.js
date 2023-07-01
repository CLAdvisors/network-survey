import React from 'react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import { ReactComponent as Logo } from './logo.svg';

const Survey = () => {

    const [title, setTitle] = React.useState("");

    return (
        <div>
            <Header svgComponent={<Logo />} title={title} />
            <SurveyComponent setTitle={setTitle}/>
        </div>
        
    );
};

export default Survey;