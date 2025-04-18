import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  Avatar,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';

export const ChatContainerComp = ({ messages }) => {
  // const [messages, setMessages] = useState([
  //   { id: 1, text: "Hello! How are you?", sender: "Joe"},
  //   { id: 2, text: "I'm good, thank you!", sender: "Me" }
  // ]);

  // const loadMoreMessages = () => {
  //   // Simulate loading more messages (you could fetch these from an API)
  //   const moreMessages = [
  //     { id: 3, text: "What about you?", sender: "Joe", direction: "incoming" },
  //     { id: 4, text: "I'm great, thanks!", sender: "Me", direction: "outgoing" }
  //   ];
  //   setMessages((prevMessages) => [...moreMessages, ...prevMessages]);
  // };

  return (
    <div style={{ height: '500px', width: '300px' }}>
      <MainContainer>
        <ChatContainer>
          <MessageList>
            {messages.map((msg) => (
              <Message
                key={msg.id}
                model={{
                  message: msg.text,
                  sentTime: 'just now',
                  sender: msg.senderName,
                  direction: 'incoming',
                  position: 'single',
                }}
              >
                {msg.direction === 'incoming' && (
                  <Avatar name={msg.senderName} />
                )}
              </Message>
            ))}
          </MessageList>

          <MessageInput placeholder="Type a message..." />
        </ChatContainer>
      </MainContainer>
    </div>
  );
};
