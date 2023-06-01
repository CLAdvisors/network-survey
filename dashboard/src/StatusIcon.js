import React from 'react';
import './StatusIcon.css';


const StatusIcon = ({ text, mode }) => {

  let icon = null;

  if (mode === 'icon_green') {
    icon = '✔';
  } else if (mode === 'icon_red') {
    icon = '✖';
  } 
  return (
    <div>
      <label className='icon_label'>{text} <span className={mode}>{icon}</span></label>
    </div>
  );
};

export default StatusIcon;