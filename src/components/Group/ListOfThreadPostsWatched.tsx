import * as React from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import { executeEvent } from '../../utils/events';
import { Box, Typography } from '@mui/material';
import { Spacer } from '../../common/Spacer';
import { CustomLoader } from '../../common/CustomLoader';
import VisibilityIcon from '@mui/icons-material/Visibility';

export const ListOfThreadPostsWatched = () => {
  const [posts, setPosts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const getPosts = async () => {
    try {
      await new Promise((res, rej) => {
        window
          .sendMessage('getThreadActivity', {})
          .then((response) => {
            if (!response?.error) {
              if (!response) {
                res(null);
                return;
              }
              const uniquePosts = response.reduce((acc, current) => {
                const x = acc.find(
                  (item) => item?.thread?.threadId === current?.thread?.threadId
                );
                if (!x) {
                  return acc.concat([current]);
                } else {
                  return acc;
                }
              }, []);
              setPosts(uniquePosts);
              res(uniquePosts);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred'); // TODO translate
          });
      });
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    getPosts();
  }, []);

  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Box
        sx={{
          width: '322px',
          display: 'flex',
          flexDirection: 'column',
          padding: '0px 20px',
        }}
      >
        <Typography
          sx={{
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          New Thread Posts:
        </Typography>
        <Spacer height="10px" />
      </Box>

      <Box
        sx={{
          bgcolor: 'background.paper',
          borderRadius: '19px',
          display: 'flex',
          flexDirection: 'column',
          height: '250px',
          padding: '20px',
          width: '322px',
        }}
      >
        {loading && posts.length === 0 && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <CustomLoader />
          </Box>
        )}
        {!loading && posts.length === 0 && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <Typography
              sx={{
                fontSize: '11px',
                fontWeight: 400,
                color: 'rgba(255, 255, 255, 0.2)',
              }}
            >
              Nothing to display
            </Typography>
          </Box>
        )}
        {posts?.length > 0 && (
          <List
            className="scrollable-container"
            sx={{
              width: '100%',
              maxWidth: 360,
              bgcolor: 'background.paper',
              maxHeight: '300px',
              overflow: 'auto',
            }}
          >
            {posts?.map((post) => {
              return (
                <ListItem
                  key={post?.thread?.threadId}
                  onClick={() => {
                    executeEvent('openThreadNewPost', {
                      data: post,
                    });
                  }}
                  disablePadding
                  secondaryAction={
                    <IconButton edge="end" aria-label="comments">
                      <VisibilityIcon
                        sx={{
                          color: 'red',
                        }}
                      />
                    </IconButton>
                  }
                >
                  <ListItemButton disableRipple role={undefined} dense>
                    <ListItemText
                      primary={`New post in ${post?.thread?.threadData?.title}`}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
};
