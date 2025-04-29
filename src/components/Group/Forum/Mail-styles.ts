import { Typography, Box } from '@mui/material';
import { styled } from '@mui/system';

export const MailContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: 'calc(100vh - 78px)',
  overflow: 'hidden',
}));

export const MailBody = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'row',
  width: '100%',
  height: 'calc(100% - 59px)',
}));

export const MailBodyInner = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '50%',
  height: '100%',
}));

export const MailBodyInnerHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '100%',
  height: '25px',
  marginTop: '50px',
  marginBottom: '35px',
  justifyContent: 'center',
  alignItems: 'center',
  gap: '11px',
}));

export const MailBodyInnerScroll = styled(Box)`
  display: flex;
  flex-direction: column;
  overflow: auto !important;
  transition: background-color 0.3s;
  height: calc(100% - 110px);
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
  display: 'flex',
  width: '150px',
  alignItems: 'center',
  gap: '7px',
  height: '100%',
  cursor: 'pointer',
  transition: '0.2s background-color',
  justifyContent: 'center',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const ComposeContainerBlank = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '150px',
  alignItems: 'center',
  gap: '7px',
  height: '100%',
}));

export const ComposeP = styled(Typography)(({ theme }) => ({
  fontSize: '15px',
  fontWeight: 500,
}));

export const ComposeIcon = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
  cursor: 'pointer',
});

export const ArrowDownIcon = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
  cursor: 'pointer',
});

export const MailIconImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
});

export const MailMessageRowInfoImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
});

export const SelectInstanceContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '17px',
}));

export const SelectInstanceContainerFilterInner = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '3px',
  cursor: 'pointer',
  padding: '8px',
  transition: 'all 0.2s',
}));

export const InstanceLabel = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 500,
  color: '#FFFFFF33',
}));

export const InstanceP = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 500,
}));

export const InstanceListParent = styled(Typography)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '425px', // only one width now
  minHeight: '246px',
  maxHeight: '325px',
  padding: '10px 0px 7px 0px',
  border: '1px solid rgba(0, 0, 0, 0.1)',
}));
export const InstanceListHeader = styled(Typography)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
}));

export const InstanceFooter = styled(Box)`
  display: flex;
  flex-direction: column;
  width: 100%;
  flex-shrink: 0;
`;

export const InstanceListContainer = styled(Box)`
  width: 100%;
  display: flex;
  flex-direction: column;
  flex-grow: 1;

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

export const InstanceListContainerRowLabelContainer = styled(Box)(
  ({ theme }) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    height: '50px',
  })
);

export const InstanceListContainerRow = styled(Box)(({ theme }) => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  height: '50px',
  cursor: 'pointer',
  transition: '0.2s background',
  '&:hover': {
    background: theme.palette.action.hover,
  },
  flexShrink: 0,
}));

export const InstanceListContainerRowCheck = styled(Box)(({ theme }) => ({
  width: '47px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

export const InstanceListContainerRowMain = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  width: '100%',
  alignItems: 'center',
  paddingRight: '30px',
  overflow: 'hidden',
}));

export const CloseParent = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '20px',
}));

export const InstanceListContainerRowMainP = styled(Typography)(
  ({ theme }) => ({
    fontWeight: 500,
    fontSize: '16px',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  })
);

export const InstanceListContainerRowCheckIcon = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
});
export const InstanceListContainerRowGroupIcon = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
});

export const NewMessageCloseImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
  cursor: 'pointer',
});
export const NewMessageHeaderP = styled(Typography)(({ theme }) => ({
  fontSize: '18px',
  fontWeight: 600,
  color: theme.palette.text.primary,
}));

export const NewMessageInputRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '3px solid rgba(237, 239, 241, 1)',
  width: '100%',
  paddingBottom: '6px',
}));
export const NewMessageInputLabelP = styled(Typography)`
  color: rgba(84, 84, 84, 0.7);
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  line-height: 120%; /* 24px */
  letter-spacing: 0.15px;
`;
export const AliasLabelP = styled(Typography)`
  color: rgba(84, 84, 84, 0.7);
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%; /* 24px */
  letter-spacing: 0.15px;
  transition: color 0.2s;
  cursor: pointer;
  &:hover {
    color: rgba(43, 43, 43, 1);
  }
`;
export const NewMessageAliasContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
}));
export const AttachmentContainer = styled(Box)(({ theme }) => ({
  height: '36px',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
}));

export const NewMessageAttachmentImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
  cursor: 'pointer',
  padding: '10px',
  border: '1px dashed #646464',
});

export const NewMessageSendButton = styled(Box)(({ theme }) => ({
  borderRadius: '4px',
  border: `1px solid ${theme.palette.border.main}`, // you can replace with theme.palette.divider or whatever you want later
  display: 'inline-flex',
  padding: '8px 16px 8px 12px',
  justifyContent: 'center',
  alignItems: 'center',
  width: 'fit-content',
  transition: 'all 0.2s',
  color: theme.palette.text.primary, // replace later with theme.palette.text.primary if needed
  minWidth: '120px',
  position: 'relative',
  gap: '8px',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: theme.palette.action.hover, // replace with theme value if needed
  },
}));

export const NewMessageSendP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%; /* 19.2px */
  letter-spacing: -0.16px;
`;

export const ShowMessageNameP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-weight: 900;
  line-height: 19px;
  letter-spacing: 0em;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
`;

export const ShowMessageSubjectP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-weight: 500;
  line-height: 19px;
  letter-spacing: 0.0075em;
  text-align: left;
`;

export const ShowMessageButton = styled(Box)(({ theme }) => ({
  display: 'inline-flex',
  padding: '8px 16px',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'fit-content',
  transition: 'all 0.2s',
  color: theme.palette.text.primary, // you'll replace with theme value
  minWidth: '120px',
  gap: '8px',
  borderRadius: '4px',
  border: theme.palette.border.main, // you'll replace
  fontFamily: 'Roboto',
  cursor: 'pointer',
  '&:hover': {
    background: theme.palette.action.hover, // you'll replace
    borderRadius: '4px',
  },
}));

export const ShowMessageReturnButton = styled(Box)(({ theme }) => ({
  display: 'inline-flex',
  padding: '8px 16px',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'fit-content',
  transition: 'all 0.2s',
  color: theme.palette.text.primary, // you'll replace with theme value
  minWidth: '120px',
  gap: '8px',
  borderRadius: '4px',
  fontFamily: 'Roboto',
  cursor: 'pointer',
  '&:hover': {
    background: theme.palette.action.hover, // you'll replace
    borderRadius: '4px',
  },
}));

export const ShowMessageButtonImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
  cursor: 'pointer',
});

export const MailAttachmentImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
});

export const AliasAvatarImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
});

export const MoreImg = styled('img')({
  width: 'auto',
  height: 'auto',
  userSelect: 'none',
  objectFit: 'contain',
  transition: '0.2s all',
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
  lineHeight: '120%', // 19.2px
  letterSpacing: '-0.16px',
  whiteSpace: 'nowrap',
}));

export const ThreadContainerFullWidth = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  alignItems: 'center',
}));

export const ThreadContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: '95%',
}));

export const GroupNameP = styled(Typography)`
  font-size: 25px;
  font-style: normal;
  font-weight: 700;
  line-height: 120%; /* 30px */
  letter-spacing: 0.188px;
`;

export const AllThreadP = styled(Typography)`
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  line-height: 120%; /* 24px */
  letter-spacing: 0.15px;
`;

export const SingleThreadParent = styled(Box)(({ theme }) => ({
  borderRadius: '35px 4px 4px 35px',
  position: 'relative',
  display: 'flex',
  padding: '13px',
  cursor: 'pointer',
  marginBottom: '5px',
  height: '76px',
  alignItems: 'center',
  transition: '0.2s all',
  backgroundColor: theme.palette.background.paper, // or remove if you want no background by default
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const SingleTheadMessageParent = styled(Box)(({ theme }) => ({
  borderRadius: '35px 4px 4px 35px',
  background: theme.palette.background.paper,
  display: 'flex',
  padding: '13px',
  cursor: 'pointer',
  marginBottom: '5px',
  height: '76px',
  alignItems: 'center',
}));

export const ThreadInfoColumn = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '170px',
  gap: '2px',
  marginLeft: '10px',
  height: '100%',
  justifyContent: 'center',
}));

export const ThreadInfoColumnNameP = styled(Typography)`
  font-family: Roboto;
  font-size: 16px;
  font-style: normal;
  font-weight: 900;
  line-height: normal;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
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
  white-space: wrap;
  text-overflow: ellipsis;
  overflow: hidden;
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
  position: relative;
  overflow: auto;
  width: 100%;
`;

export const CloseContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '50px',
  overflow: 'hidden',
  alignItems: 'center',
  cursor: 'pointer',
  transition: '0.2s background-color',
  justifyContent: 'center',
  position: 'absolute',
  top: '0px',
  right: '0px',
  height: '50px',
  borderRadius: '0px 12px 0px 0px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));
