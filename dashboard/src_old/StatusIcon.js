import React from 'react';
import './StatusIcon.css';


const StatusIcon = ({ text, mode }) => {

  // useState for icon

  const [icon, setIcon] = React.useState('✖');

  React.useEffect(() => {
    console.log(mode);
    if (mode === 'icon_green') {
      setIcon('✔');
    } else if (mode === 'icon_red') {
      setIcon('✖');
    } 
  }, [mode]);

  return (
    <div>
      <label className='icon_label'>{text} <span className={mode}>{icon}</span></label>
    </div>
  );
};

export default StatusIcon;