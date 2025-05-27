import { Typography, Box } from '@mui/material';
import { styled } from '@mui/system';

export const MailContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 78px)',
  overflow: 'hidden',
  width: '100%',
}));

export const MailBody = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'row',
  height: 'calc(100% - 59px)',
  width: '100%',
}));

export const MailBodyInner = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '50%',
}));

export const MailBodyInnerHeader = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  gap: '11px',
  height: '25px',
  justifyContent: 'center',
  marginBottom: '35px',
  marginTop: '50px',
  width: '100%',
}));

export const MailBodyInnerScroll = styled(Box)`
  display: flex;
  flex-direction: column;
  height: calc(100% - 110px);
  overflow: auto !important;
  transition: background-color 0.3s;
  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
    background-color: transparent; /* Initially transparent */
    transition: background-color 0.3s; /* Transition for background color */
  }
  &::-webkit-scrollbar-thumb {
    background-color: transparent; /* Initially transparent */
    border-radius: 3px; /* Scrollbar thumb radius */
    transition: background-color 0.3s; /* Transition for thumb color */
  }
  &:hover {
    &::-webkit-scrollbar {
      background-color: #494747; /* Scrollbar background color on hover */
    }
    &::-webkit-scrollbar-thumb {
      background-color: #ffffff3d; /* Scrollbar thumb color on hover */
    }
    &::-webkit-scrollbar-thumb:hover {
      background-color: #ffffff3d; /* Color when hovering over the thumb */
    }
  }
`;

export const ComposeContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  cursor: 'pointer',
  display: 'flex',
  gap: '7px',
  height: '100%',
  justifyContent: 'center',
  transition: '0.2s background-color',
  width: '150px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const ComposeContainerBlank = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  gap: '7px',
  height: '100%',
  width: '150px',
}));

export const ComposeP = styled(Typography)(({ theme }) => ({
  fontSize: '15px',
  fontWeight: 500,
}));

export const ComposeIcon = styled('img')({
  cursor: 'pointer',
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const ArrowDownIcon = styled('img')({
  cursor: 'pointer',
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const MailIconImg = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const MailMessageRowInfoImg = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const SelectInstanceContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  gap: '17px',
}));

export const SelectInstanceContainerFilterInner = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  cursor: 'pointer',
  display: 'flex',
  gap: '3px',
  padding: '8px',
  transition: 'all 0.2s',
}));

export const InstanceLabel = styled(Typography)(({ theme }) => ({
  color: '#FFFFFF33',
  fontSize: '16px',
  fontWeight: 500,
}));

export const InstanceP = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 500,
}));

export const InstanceListParent = styled(Typography)(({ theme }) => ({
  border: '1px solid rgba(0, 0, 0, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '325px',
  minHeight: '246px',
  padding: '10px 0px 7px 0px',
  width: '425px', // only one width now
}));

export const InstanceListHeader = styled(Typography)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
}));

export const InstanceFooter = styled(Box)`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 100%;
`;

export const InstanceListContainer = styled(Box)`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow: auto !important;
  transition: background-color 0.3s;
  width: 100%;
  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
    background-color: transparent; /* Initially transparent */
    transition: background-color 0.3s; /* Transition for background color */
  }
  &::-webkit-scrollbar-thumb {
    background-color: transparent; /* Initially transparent */
    border-radius: 3px; /* Scrollbar thumb radius */
    transition: background-color 0.3s; /* Transition for thumb color */
  }
  &:hover {
    &::-webkit-scrollbar {
      background-color: #494747; /* Scrollbar background color on hover */
    }
    &::-webkit-scrollbar-thumb {
      background-color: #ffffff3d; /* Scrollbar thumb color on hover */
    }
    &::-webkit-scrollbar-thumb:hover {
      background-color: #ffffff3d; /* Color when hovering over the thumb */
    }
  }
`;

export const InstanceListContainerRowLabelContainer = styled(Box)(
  ({ theme }) => ({
    alignItems: 'center',
    display: 'flex',
    gap: '10px',
    height: '50px',
    width: '100%',
  })
);

export const InstanceListContainerRow = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  cursor: 'pointer',
  display: 'flex',
  flexShrink: 0,
  gap: '10px',
  height: '50px',
  transition: '0.2s background',
  width: '100%',
  '&:hover': {
    background: theme.palette.action.hover,
  },
}));

export const InstanceListContainerRowCheck = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'center',
  width: '47px',
}));

export const InstanceListContainerRowMain = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  overflow: 'hidden',
  paddingRight: '30px',
  width: '100%',
}));

export const CloseParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  gap: '20px',
}));

export const InstanceListContainerRowMainP = styled(Typography)(
  ({ theme }) => ({
    fontSize: '16px',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })
);

export const InstanceListContainerRowCheckIcon = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const InstanceListContainerRowGroupIcon = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const NewMessageCloseImg = styled('img')({
  cursor: 'pointer',
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const NewMessageHeaderP = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.primary,
  fontSize: '18px',
  fontWeight: 600,
}));

export const NewMessageInputRow = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  borderBottom: '3px solid rgba(237, 239, 241, 1)',
  display: 'flex',
  justifyContent: 'space-between',
  paddingBottom: '6px',
  width: '100%',
}));

export const NewMessageInputLabelP = styled(Typography)`
  color: rgba(84, 84, 84, 0.7);
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.15px;
  line-height: 120%; /* 24px */
`;

export const AliasLabelP = styled(Typography)`
  color: rgba(84, 84, 84, 0.7);
  cursor: pointer;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  letter-spacing: 0.15px;
  line-height: 120%; /* 24px */
  transition: color 0.2s;
  &:hover {
    color: rgba(43, 43, 43, 1);
  }
`;

export const NewMessageAliasContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  gap: '12px',
}));

export const AttachmentContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  height: '36px',
  width: '100%',
}));

export const NewMessageAttachmentImg = styled('img')({
  border: '1px dashed #646464',
  cursor: 'pointer',
  height: 'auto',
  objectFit: 'contain',
  padding: '10px',
  userSelect: 'none',
  width: 'auto',
});

export const NewMessageSendButton = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  border: `1px solid ${theme.palette.border.main}`, // you can replace with theme.palette.divider or whatever you want later
  borderRadius: '4px',
  color: theme.palette.text.primary, // replace later with theme.palette.text.primary if needed
  cursor: 'pointer',
  display: 'inline-flex',
  gap: '8px',
  justifyContent: 'center',
  minWidth: '120px',
  padding: '8px 16px 8px 12px',
  position: 'relative',
  transition: 'all 0.2s',
  width: 'fit-content',
  '&:hover': {
    backgroundColor: theme.palette.action.hover, // replace with theme value if needed
  },
}));

export const NewMessageSendP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  letter-spacing: -0.16px;
  line-height: 120%; /* 19.2px */
`;

export const ShowMessageNameP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0em;
  line-height: 19px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ShowMessageSubjectP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 0.0075em;
  line-height: 19px;
  text-align: left;
`;

export const ShowMessageButton = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  border: theme.palette.border.main, // you'll replace
  borderRadius: '4px',
  color: theme.palette.text.primary, // you'll replace with theme value
  cursor: 'pointer',
  display: 'inline-flex',
  fontFamily: 'Roboto',
  gap: '8px',
  justifyContent: 'center',
  minWidth: '120px',
  padding: '8px 16px',
  transition: 'all 0.2s',
  width: 'fit-content',
  '&:hover': {
    background: theme.palette.action.hover, // you'll replace
    borderRadius: '4px',
  },
}));

export const ShowMessageReturnButton = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  borderRadius: '4px',
  color: theme.palette.text.primary, // you'll replace with theme value
  cursor: 'pointer',
  display: 'inline-flex',
  fontFamily: 'Roboto',
  gap: '8px',
  justifyContent: 'center',
  minWidth: '120px',
  padding: '8px 16px',
  transition: 'all 0.2s',
  width: 'fit-content',
  '&:hover': {
    background: theme.palette.action.hover, // you'll replace
    borderRadius: '4px',
  },
}));

export const ShowMessageButtonImg = styled('img')({
  cursor: 'pointer',
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const MailAttachmentImg = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const AliasAvatarImg = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  userSelect: 'none',
  width: 'auto',
});

export const MoreImg = styled('img')({
  height: 'auto',
  objectFit: 'contain',
  transition: '0.2s all',
  userSelect: 'none',
  width: 'auto',
  '&:hover': {
    transform: 'scale(1.3)',
  },
});

export const MoreP = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.primary, // Now dynamic
  fontFamily: 'Roboto',
  fontSize: '16px',
  fontStyle: 'normal',
  fontWeight: 400,
  letterSpacing: '-0.16px',
  lineHeight: '120%', // 19.2px
  whiteSpace: 'nowrap',
}));

export const ThreadContainerFullWidth = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
}));

export const ThreadContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  maxWidth: '95%',
  width: '100%',
}));

export const GroupNameP = styled(Typography)`
  font-size: 25px;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.188px;
  line-height: 120%; /* 30px */
`;

export const AllThreadP = styled(Typography)`
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.15px;
  line-height: 120%; /* 24px */
`;

export const SingleThreadParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper, // or remove if you want no background by default
  borderRadius: '35px 4px 4px 35px',
  cursor: 'pointer',
  display: 'flex',
  height: '76px',
  marginBottom: '5px',
  padding: '13px',
  position: 'relative',
  transition: '0.2s all',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const SingleTheadMessageParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  background: theme.palette.background.paper,
  borderRadius: '35px 4px 4px 35px',
  cursor: 'pointer',
  display: 'flex',
  height: '76px',
  marginBottom: '5px',
  padding: '13px',
}));

export const ThreadInfoColumn = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  height: '100%',
  justifyContent: 'center',
  marginLeft: '10px',
  width: '170px',
}));

export const ThreadInfoColumnNameP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-style: normal;
  font-weight: 900;
  line-height: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ThreadInfoColumnbyP = styled('span')(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontFamily: 'Roboto',
  fontSize: '16px',
  fontStyle: 'normal',
  fontWeight: 500,
  lineHeight: 'normal',
}));

export const ThreadInfoColumnTime = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontFamily: 'Roboto',
  fontSize: '15px',
  fontStyle: 'normal',
  fontWeight: 500,
  lineHeight: 'normal',
}));

export const ThreadSingleTitle = styled(Typography)`
  font-family: Roboto;
  font-size: 23px;
  font-style: normal;
  font-weight: 700;
  line-height: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: wrap;
`;

export const ThreadSingleLastMessageP = styled(Typography)`
  font-family: Roboto;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
`;

export const ThreadSingleLastMessageSpanP = styled('span')`
  font-family: Roboto;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
`;

export const GroupContainer = styled(Box)`
  overflow: auto;
  position: relative;
  width: 100%;
`;

export const CloseContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  borderRadius: '0px 12px 0px 0px',
  cursor: 'pointer',
  display: 'flex',
  height: '50px',
  justifyContent: 'center',
  overflow: 'hidden',
  position: 'absolute',
  right: '0px',
  top: '0px',
  transition: '0.2s background-color',
  width: '50px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));
