import {
    AppBar,
    Button,
    Toolbar,
    Typography,
    Box,
    TextField,
    InputLabel,
    ButtonBase,
  } from "@mui/material";
  import { styled } from "@mui/system";
  
  export const AppsParent = styled(Box)(({ theme }) => ({
    display: "flex",
      width: "100%",
      flexDirection: "column",
      height: "100%",
      alignItems: "center",
      overflow: 'auto',
        // For WebKit-based browsers (Chrome, Safari, etc.)
    "::-webkit-scrollbar": {
        width: "0px", // Set the width to 0 to hide the scrollbar
        height: "0px", // Set the height to 0 for horizontal scrollbar
      },
    
      // For Firefox
      scrollbarWidth: "none", // Hides the scrollbar in Firefox
    
      // Optional for better cross-browser consistency
      "-ms-overflow-style": "none" // Hides scrollbar in IE and Edge
  }));
  export const AppsContainer = styled(Box)(({ theme }) => ({
    display: "flex",
    width: "90%",
    justifyContent: 'space-evenly',
    gap: '24px',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    alignSelf: 'center'
  
  }));
  export const AppsLibraryContainer = styled(Box)(({ theme }) => ({
    display: "flex",
    width: "100%",
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'center',
  }));
  export const AppsWidthLimiter = styled(Box)(({ theme }) => ({
    display: "flex",
    width: "90%",
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  }));
  export const AppsSearchContainer = styled(Box)(({ theme }) => ({
    display: "flex",
    width: "90%",
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#434343',
    borderRadius: '8px',
    padding: '0px 10px',
    height: '36px'
  }));
  export const AppsSearchLeft = styled(Box)(({ theme }) => ({
    display: "flex",
    width: "90%",
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: '10px',
    flexGrow: 1,
    flexShrink: 0
  }));
  export const AppsSearchRight = styled(Box)(({ theme }) => ({
    display: "flex",
    width: "90%",
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexShrink: 1
  }));
  export const AppCircleContainer = styled(Box)(({ theme }) => ({
    display: "flex",
      flexDirection: "column",
      gap: '5px',
      alignItems: 'center',
      width: '100%'
  }));
  export const Add = styled(Typography)(({ theme }) => ({
    fontSize: '36px',
    fontWeight: 500,
    lineHeight: '43.57px',
    textAlign: 'left'
    
  }));
  export const AppCircleLabel = styled(Typography)(({ theme }) => ({
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.2,
    // whiteSpace: 'nowrap',   
  overflow: 'hidden',     
  textOverflow: 'ellipsis', 
  width: '120%',
  '-webkit-line-clamp': '2',
  '-webkit-box-orient': 'vertical',
  'display': '-webkit-box',
    
  }));
  export const AppLibrarySubTitle = styled(Typography)(({ theme }) => ({
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: 1.2,
  }));
  export const AppCircle = styled(Box)(({ theme }) => ({
    display: "flex",
      width: "75px",
      flexDirection: "column",
      height: "75px",
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      backgroundColor: "var(--apps-circle)",
      border: '1px solid #FFFFFF'
  }));

  export const AppInfoSnippetContainer = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%'
  }));

  export const AppInfoSnippetLeft = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: '12px'
  }));
  export const AppInfoSnippetRight = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'flex-end',
    alignItems: 'center',
  }));

  export const AppDownloadButton = styled(ButtonBase)(({ theme }) => ({
    backgroundColor: "#247C0E",
    width: '101px',
    height: '29px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '25px',
    alignSelf: 'center'
  }));

  export const AppDownloadButtonText = styled(Typography)(({ theme }) => ({
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.2,
  }));

  export const AppPublishTagsContainer = styled(Box)(({theme})=> ({
    gap: '10px',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    width: '100%',
    display: 'flex'
  }))


  export const AppInfoSnippetMiddle = styled(Box)(({ theme }) => ({
    display: "flex",
    flexDirection: "column",
    justifyContent: 'center',
    alignItems: 'flex-start',
  }));

  export const AppInfoAppName = styled(Typography)(({ theme }) => ({
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: 1.2,
    textAlign: 'start'
  }));
  export const AppInfoUserName = styled(Typography)(({ theme }) => ({
    fontSize: '13px',
    fontWeight: 400,
    lineHeight: 1.2,
    color: '#8D8F93',
    textAlign: 'start'
  }));


  export const AppsNavBarParent = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    height: '60px',
    backgroundColor: '#1F2023',
    padding: '0px 10px',
    position: "fixed",
    bottom: 0,
    zIndex: 1,
  }));

  export const AppsNavBarLeft = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'flex-start',
    alignItems: 'center',
    flexGrow: 1
  }));
  export const AppsNavBarRight = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'flex-end',
    alignItems: 'center',
  }));

  export const TabParent = styled(Box)(({ theme }) => ({
    height: '36px',
    width: '36px',
    backgroundColor: '#434343',
    position: 'relative',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }));

  export const PublishQAppCTAParent = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#181C23'
  }));

  export const PublishQAppCTALeft = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'flex-start',
    alignItems: 'center',
  }));
  export const PublishQAppCTARight = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'flex-end',
    alignItems: 'center',
  }));

  export const PublishQAppCTAButton = styled(ButtonBase)(({ theme }) => ({
    width: '101px',
    height: '29px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '25px',
    border: '1px solid #FFFFFF'
  }));
  export const PublishQAppDotsBG = styled(Box)(({ theme }) => ({
    display: "flex",
    justifyContent: 'center',
    alignItems: 'center',
    width: '60px',
    height: '60px',
    backgroundColor: '#4BBCFE'
  }));
  
  export const PublishQAppInfo = styled(Typography)(({ theme }) => ({
    fontSize: '10px',
    fontWeight: 400,
    lineHeight: 1.2,
    fontStyle: 'italic'
  }));

  export const PublishQAppChoseFile = styled(ButtonBase)(({ theme }) => ({
    width: '101px',
    height: '30px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '5px',
    backgroundColor: '#0091E1',
    color: 'white',
    fontWeight: 600,
    fontSize: '10px'
  }));


  export const AppsCategoryInfo =  styled(Box)(({ theme }) => ({
    display: "flex",
    alignItems: 'center',
    width: '100%',
  }));

  export const AppsCategoryInfoSub =  styled(Box)(({ theme }) => ({
    display: "flex",
    flexDirection: 'column',
  }));
  export const AppsCategoryInfoLabel =  styled(Typography)(({ theme }) => ({
    fontSize: '12px',
    fontWeight: 700,
    lineHeight: 1.2,
    color: '#8D8F93',
  }));
  export const AppsCategoryInfoValue =  styled(Typography)(({ theme }) => ({
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: 1.2,
    color: '#8D8F93',
  }));
  export const AppsInfoDescription =  styled(Typography)(({ theme }) => ({
    fontSize: '13px',
    fontWeight: 300,
    lineHeight: 1.2,
    width: '90%',
    textAlign: 'start'
  }));