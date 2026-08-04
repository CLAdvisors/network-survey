import React from 'react';
import { Box, Typography } from '@mui/material';
import { appShadows } from '@network-survey/frontend-react';
import { BRAND } from '@network-survey/frontend-shared';

const Header = ({ svgComponent: SvgComponent, title, forceMobile = false }) => {
  const compactTitleSx = forceMobile
    ? {
      m: 0,
      minWidth: 0,
      maxWidth: '100%',
      overflow: 'hidden',
      overflowWrap: 'anywhere',
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: 2,
      fontSize: '0.95rem',
      lineHeight: 1.3,
    }
    : {
      m: 0,
      minWidth: 0,
      maxWidth: '100%',
      overflow: { xs: 'hidden', sm: 'visible' },
      overflowWrap: { xs: 'anywhere', sm: 'normal' },
      display: { xs: '-webkit-box', sm: 'block' },
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: { xs: 2, sm: 'unset' },
      fontSize: { xs: '0.95rem', sm: '1.25rem' },
      lineHeight: { xs: 1.3, sm: 1.6 },
    };

  const titleElement = (
    <Typography component="h1" variant="h6" sx={compactTitleSx} aria-label={title || undefined} title={title || undefined}>
      {title}
    </Typography>
  );

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: 'flex',
        alignItems: 'center',
        minHeight: forceMobile ? 52 : { xs: 52, sm: 64 },
        px: forceMobile ? 2 : { xs: 2, sm: 3 },
        py: forceMobile ? 0.5 : { xs: 0.5, sm: 1.5 },
        bgcolor: 'background.paper',
        boxShadow: appShadows.surface,
      }}
    >
      {forceMobile ? (
        titleElement
      ) : (
        <>
          <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', width: '100%' }}>
            <Box sx={{ minWidth: 150, maxWidth: 280, ml: { sm: 3 }, pr: 1 }}>
              <a href={BRAND.websiteUrl} target="_blank" rel="noreferrer">
                {SvgComponent}
              </a>
            </Box>
          </Box>
          <Box sx={{ display: { xs: 'block', sm: 'none' }, minWidth: 0, width: '100%' }}>
            {titleElement}
          </Box>
        </>
      )}
    </Box>
  );
};

export default Header;
