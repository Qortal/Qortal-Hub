import * as React from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import ListItemText from "@mui/material/ListItemText";
import ListItemButton from "@mui/material/ListItemButton";
import List from "@mui/material/List";
import Divider from "@mui/material/Divider";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import Slide from "@mui/material/Slide";
import { TransitionProps } from "@mui/material/transitions";
import {
  Box,
  Collapse,
  Input,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tab,
  Tabs,
  styled,
} from "@mui/material";
import { AddGroupList } from "./AddGroupList";
import { UserListOfInvites } from "./UserListOfInvites";
import { CustomizedSnackbars } from "../Snackbar/Snackbar";
import { getFee } from "../../background";
import { MyContext, isMobile } from "../../App";
import { subscribeToEvent, unsubscribeFromEvent } from "../../utils/events";

export const Label = styled("label")(
  ({ theme }) => `
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  display: block;
  margin-bottom: 4px;
  font-weight: 400;
  `
);
const Transition = React.forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement;
  },
  ref: React.Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export const AddGroup = ({ address, open, setOpen }) => {
  const {show, setTxList} = React.useContext(MyContext)

  const [tab, setTab] = React.useState("create");
  const [openAdvance, setOpenAdvance] = React.useState(false);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [groupType, setGroupType] = React.useState("1");
  const [approvalThreshold, setApprovalThreshold] = React.useState("40");
  const [minBlock, setMinBlock] = React.useState("5");
  const [maxBlock, setMaxBlock] = React.useState("21600");
  const [value, setValue] = React.useState(0);
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };
  const handleClose = () => {
    setOpen(false);
  };

  const handleChangeGroupType = (event: SelectChangeEvent) => {
    setGroupType(event.target.value as string);
  };

  const handleChangeApprovalThreshold = (event: SelectChangeEvent) => {
    setApprovalThreshold(event.target.value as string);
  };

  const handleChangeMinBlock = (event: SelectChangeEvent) => {
    setMinBlock(event.target.value as string);
  };

  const handleChangeMaxBlock = (event: SelectChangeEvent) => {
    setMaxBlock(event.target.value as string);
  };

  

  const handleCreateGroup = async () => {
    try {
      if(!name) throw new Error('Please provide a name')
      if(!description) throw new Error('Please provide a description')

      const fee = await getFee('CREATE_GROUP')
      await show({
        message: "Would you like to perform an CREATE_GROUP transaction?" ,
        publishFee: fee.fee + ' QORT'
      })

     await new Promise((res, rej) => {
      window.sendMessage("createGroup", {
        groupName: name,
        groupDescription: description,
        groupType: +groupType,
        groupApprovalThreshold: +approvalThreshold,
        minBlock: +minBlock,
        maxBlock: +maxBlock,
      })
        .then((response) => {
          if (!response?.error) {
            setInfoSnack({
              type: "success",
              message: "Successfully created group. It may take a couple of minutes for the changes to propagate",
            });
            setOpenSnack(true);
            setTxList((prev) => [
              {
                ...response,
                type: 'created-group',
                label: `Created group ${name}: awaiting confirmation`,
                labelDone: `Created group ${name}: success!`,
                done: false,
              },
              ...prev,
            ]);
            res(response);
            return;
          }
          rej({ message: response.error });
        })
        .catch((error) => {
          rej({ message: error.message || "An error occurred" });
        });
      
      });
    } catch (error) {
      setInfoSnack({
        type: "error",
        message: error?.message,
      });
      setOpenSnack(true);
    }
  };

  function CustomTabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
      <div
        role="tabpanel"
        hidden={value !== index}
        id={`simple-tabpanel-${index}`}
        aria-labelledby={`simple-tab-${index}`}
        {...other}
      >
        {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
      </div>
    );
  }

  function a11yProps(index: number) {
    return {
      id: `simple-tab-${index}`,
      "aria-controls": `simple-tabpanel-${index}`,
    };
  }


  const openGroupInvitesRequestFunc = ()=> {
    setValue(2)
  }

  React.useEffect(() => {
    subscribeToEvent("openGroupInvitesRequest", openGroupInvitesRequestFunc);

    return () => {
      unsubscribeFromEvent("openGroupInvitesRequest", openGroupInvitesRequestFunc);
    };
  }, []);

  return (
    <React.Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        TransitionComponent={Transition}
      >
        <AppBar sx={{ position: "relative", bgcolor: "#232428" }}>
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Group Mgmt
            </Typography>

            <IconButton
              edge="start"
              color="inherit"
              onClick={handleClose}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>

            {/* <Button autoFocus color="inherit" onClick={handleClose}>
              save
            </Button> */}
          </Toolbar>
        </AppBar>
        <Box
          sx={{
            bgcolor: "#27282c",
            flexGrow: 1,
            overflowY: "auto",
            color: "white",
          }}
        >
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs
      value={value}
      onChange={handleChange}
      aria-label="basic tabs example"
      variant={isMobile ? 'scrollable' : 'fullWidth'} // Scrollable on mobile, full width on desktop
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={{
        "& .MuiTabs-indicator": {
          backgroundColor: "white",
        },
      }}
    >
      <Tab
        label="Create Group"
        {...a11yProps(0)}
        sx={{
          "&.Mui-selected": {
            color: "white",
          },
          fontSize: isMobile ? '0.75rem' : '1rem', // Adjust font size for mobile
        }}
      />
      <Tab
        label="Find Group"
        {...a11yProps(1)}
        sx={{
          "&.Mui-selected": {
            color: "white",
          },
          fontSize: isMobile ? '0.75rem' : '1rem', // Adjust font size for mobile
        }}
      />
      <Tab
        label="Group Invites"
        {...a11yProps(2)}
        sx={{
          "&.Mui-selected": {
            color: "white",
          },
          fontSize: isMobile ? '0.75rem' : '1rem', // Adjust font size for mobile
        }}
      />
    </Tabs>
          </Box>
          
          {value === 0 && (
             <Box sx={{
              width: '100%',
              padding: '25px'
            }}>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "20px",
                maxWidth: "500px",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <Label>Name of group</Label>
                <Input
                  placeholder="Name of group"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Box>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <Label>Description of group</Label>

                <Input
                  placeholder="Description of group"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Box>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <Label>Group type</Label>
                <Select
                  labelId="demo-simple-select-label"
                  id="demo-simple-select"
                  value={groupType}
                  label="Group Type"
                  onChange={handleChangeGroupType}
                >
                  <MenuItem value={1}>Open (public)</MenuItem>
                  <MenuItem value={0}>
                    Closed (private) - users need permission to join
                  </MenuItem>
                </Select>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  gap: "15px",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onClick={() => setOpenAdvance((prev) => !prev)}
              >
                <Typography>Advanced options</Typography>

                {openAdvance ? <ExpandLess /> : <ExpandMore />}
              </Box>
              <Collapse in={openAdvance} timeout="auto" unmountOnExit>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                  }}
                >
                  <Label>
                    Group Approval Threshold (number / percentage of Admins that
                    must approve a transaction)
                  </Label>
                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={approvalThreshold}
                    label="Group Approval Threshold"
                    onChange={handleChangeApprovalThreshold}
                  >
                    <MenuItem value={0}>NONE</MenuItem>
                    <MenuItem value={1}>ONE </MenuItem>

                    <MenuItem value={20}>20% </MenuItem>
                    <MenuItem value={40}>40% </MenuItem>
                    <MenuItem value={60}>60% </MenuItem>
                    <MenuItem value={80}>80% </MenuItem>
                    <MenuItem value={100}>100% </MenuItem>
                  </Select>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                  }}
                >
                  <Label>
                    Minimum Block delay for Group Transaction Approvals
                  </Label>
                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={minBlock}
                    label="Minimum Block delay"
                    onChange={handleChangeMinBlock}
                  >
                    <MenuItem value={5}>5 minutes</MenuItem>
                    <MenuItem value={10}>10 minutes</MenuItem>
                    <MenuItem value={30}>30 minutes</MenuItem>
                    <MenuItem value={60}>1 hour</MenuItem>
                    <MenuItem value={180}>3 hours</MenuItem>
                    <MenuItem value={300}>5 hours</MenuItem>
                    <MenuItem value={420}>7 hours</MenuItem>
                    <MenuItem value={720}>12 hours</MenuItem>
                    <MenuItem value={1440}>1 day</MenuItem>
                    <MenuItem value={4320}>3 days</MenuItem>
                    <MenuItem value={7200}>5 days</MenuItem>
                    <MenuItem value={10080}>7 days</MenuItem>
                  </Select>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                  }}
                >
                  <Label>
                    Maximum Block delay for Group Transaction Approvals
                  </Label>
                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={maxBlock}
                    label="Maximum Block delay"
                    onChange={handleChangeMaxBlock}
                  >
                    <MenuItem value={60}>1 hour</MenuItem>
                    <MenuItem value={180}>3 hours</MenuItem>
                    <MenuItem value={300}>5 hours</MenuItem>
                    <MenuItem value={420}>7 hours</MenuItem>
                    <MenuItem value={720}>12 hours</MenuItem>
                    <MenuItem value={1440}>1 day</MenuItem>
                    <MenuItem value={4320}>3 days</MenuItem>
                    <MenuItem value={7200}>5 days</MenuItem>
                    <MenuItem value={10080}>7 days</MenuItem>
                    <MenuItem value={14400}>10 days</MenuItem>
                    <MenuItem value={21600}>15 days</MenuItem>
                  </Select>
                </Box>
              </Collapse>
              <Box
                sx={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "center",
                }}
              >
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleCreateGroup}
                >
                  Create Group
                </Button>
              </Box>
            </Box>
            </Box>
          )}
          {value === 1 && (
            <Box sx={{
              width: '100%',
              padding: '25px'
            }}>
                        <AddGroupList  setOpenSnack={setOpenSnack} setInfoSnack={setInfoSnack} />

            </Box>

          )}
    
    {value === 2 && (
            <Box sx={{
              width: '100%',
              padding: '25px'
            }}>
            <UserListOfInvites myAddress={address} setOpenSnack={setOpenSnack} setInfoSnack={setInfoSnack} />
         </Box>
    )}

 
        </Box>
        <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack}  />
      </Dialog>
    </React.Fragment>
  );
};
