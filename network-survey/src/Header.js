import React from 'react';
import './Header.css';
import {BrowserView, MobileView} from 'react-device-detect';

const Header = ({ svgComponent: SvgComponent, title }) => {

  return (
    <header className="header" style={{ 
      boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 24px'
    }}>
      <BrowserView>
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <div className="header-svg">
              <a href='https://contemporaryleadership.com/' target="_blank" rel="noreferrer">
                {SvgComponent}
              </a>
            </div>
          </div>
      </BrowserView>
      <MobileView>
        <h1 style={{ 
          color: '#42B4AF',
          fontSize: '1.25rem',
          fontWeight: 600,
          margin: 0
        }}>{title}</h1>
      </MobileView>
    </header>
  );
};

export default Header;