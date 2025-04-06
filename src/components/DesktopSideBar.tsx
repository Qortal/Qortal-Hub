import { Box, ButtonBase, useTheme } from "@mui/material";
import { HomeIcon } from "../assets/Icons/HomeIcon";
import { MessagingIcon } from "../assets/Icons/MessagingIcon";
import { Save } from "./Save/Save";
import { IconWrapper } from "./Desktop/DesktopFooter";
import { useRecoilState } from "recoil";
import { enabledDevModeAtom } from "../atoms/global";
import { AppsIcon } from "../assets/Icons/AppsIcon";
import ThemeSelector from "./Theme/ThemeSelector";

export const DesktopSideBar = ({
  goToHome,
  setDesktopSideView,
  toggleSideViewDirects,
  hasUnreadDirects,
  isDirects,
  toggleSideViewGroups,
  hasUnreadGroups,
  isGroups,
  isApps,
  setDesktopViewMode,
  desktopViewMode,
  myName,
}) => {
  const [isEnabledDevMode, setIsEnabledDevMode] =
    useRecoilState(enabledDevModeAtom);
  
  const theme = useTheme();

  return (
    <Box
      sx={{
        width: "60px",
        flexDirection: "column",
        height: "100vh",
        alignItems: "center",
        display: "flex",
        gap: "25px",
      }}
    >
      <ButtonBase
        sx={{
          width: "60px",
          height: "60px",
          paddingTop: "23px",
        }}
        onClick={() => {
          goToHome();
        }}
      >
        <HomeIcon
          height={34}
          color={
            desktopViewMode === "home" ? "white" : "rgba(250, 250, 250, 0.5)"
          }
        />
      </ButtonBase>
      <ButtonBase
        onClick={() => {
          setDesktopViewMode("apps");
          // setIsOpenSideViewDirects(false)
          // setIsOpenSideViewGroups(false)
        }}
      >
        <IconWrapper
          color={isApps ? "white" : "rgba(250, 250, 250, 0.5)"}
          label="Apps"
          selected={isApps}
          disableWidth
        >
          <AppsIcon
            color={isApps ? "white" : "rgba(250, 250, 250, 0.5)"}
            height={30}
          />
        </IconWrapper>
      </ButtonBase>
      <ButtonBase
        onClick={() => {
          setDesktopViewMode("chat");
        }}
      >
        <IconWrapper
          color={
            hasUnreadDirects || hasUnreadGroups
              ? "var(--unread)"
              : theme.palette.text.primary              
          }
          label="Chat"
          disableWidth
        >
          <MessagingIcon
            height={30}
            color={
              hasUnreadDirects || hasUnreadGroups
                ? "var(--unread)"
                : theme.palette.text.primary
                ? "rgba(250, 250, 250, 0.5)"
            }
          />
        </IconWrapper>
      </ButtonBase>
      {/* <ButtonBase
          onClick={() => {
            setDesktopSideView("groups");
            toggleSideViewGroups()
          }}
        >
            <HubsIcon
              height={30}
              color={
                hasUnreadGroups
                  ? "var(--danger)"
                  : isGroups
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
     
        </ButtonBase> */}
      <Save isDesktop disableWidth myName={myName} />
      {/* <CoreSyncStatus imageSize="30px" position="left" /> */}
      {isEnabledDevMode && (
        <ButtonBase
          onClick={() => {
            setDesktopViewMode("dev");
          }}
        >
          <IconWrapper
            color={
              desktopViewMode === "dev" ? "white" : "rgba(250, 250, 250, 0.5)"
            }
            label="Dev"
            disableWidth
          >
            <AppsIcon
              height={30}
            />
          </IconWrapper>
        </ButtonBase>
      )}

      <ThemeSelector style={{ position: "fixed", bottom: "1%" }} />
    </Box>
  );
};
