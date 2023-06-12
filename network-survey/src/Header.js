import React from 'react';
import './Header.css';
import {BrowserView, MobileView} from 'react-device-detect';

const Header = ({ svgComponent: SvgComponent, title }) => {
  const [width, setWidth] = React.useState(window.innerWidth);
  const breakpoint = 1000;

  const handleWindowSizeChange = () => {
    setWidth(window.innerWidth);
  };


  React.useEffect(() => {
    window.addEventListener('resize', handleWindowSizeChange);
    return () => {
        window.removeEventListener('resize', handleWindowSizeChange);
    }
}, []);
  

  return (
    <header className="header">
        <BrowserView>
            {width < breakpoint ? 
              (
                <h1 className="title">{title}</h1>
              ) : 
              (
                <div>
                <div className="header-svg"> <a href='https://contemporaryleadership.com/' target="_blank" rel="noreferrer">{SvgComponent}</a> </div>
                <h1 className="title">{title}</h1>
                </div>
              )}
        </BrowserView>
        <MobileView>
            <h1 className="title">{title}</h1>
        </MobileView>
    </header>
  );
};

export default Header;