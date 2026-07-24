import React from 'react';
import { Box, Typography } from '@mui/material';
import { BrowserView, MobileView } from 'react-device-detect';
import { appShadows } from '@network-survey/frontend-react';
import { BRAND } from '@network-survey/frontend-shared';

const Header = ({ svgComponent: SvgComponent, title, forceMobile = false }) => (
  <Box
    component="header"
    sx={{
      position: 'sticky',
      top: 0,
      zIndex: (theme) => theme.zIndex.appBar,
      display: 'flex',
      alignItems: 'center',
      minHeight: 64,
      px: { xs: 3, sm: 3 },
      py: 1.5,
      bgcolor: 'background.paper',
      boxShadow: appShadows.surface,
    }}
  >
    {forceMobile ? (
      <Typography component="h1" variant="h6" sx={{ m: 0 }}>
        {title}
      </Typography>
    ) : (
      <>
        <BrowserView>
          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <Box sx={{ minWidth: 150, maxWidth: 280, ml: { sm: 3 }, pr: 1 }}>
              <a href={BRAND.websiteUrl} target="_blank" rel="noreferrer">
                {SvgComponent}
              </a>
            </Box>
          </Box>
        </BrowserView>
        <MobileView>
          <Typography component="h1" variant="h6" sx={{ m: 0 }}>
            {title}
          </Typography>
        </MobileView>
      </>
    )}
  </Box>
);

export default Header;
