function decodeHTMLEntities(str) {
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
  }
  
  export const parseQortalLink = (link) => {
    const prefix = "qortal://use-embed/";
    if (!link.startsWith(prefix)) {
      throw new Error("Invalid link format");
    }
  
    // Decode any HTML entities in the link
    link = decodeHTMLEntities(link);
  
    // Separate the type and query string
    const [typePart, queryPart] = link.slice(prefix.length).split("?");
  
    // Ensure only the type is parsed
    const type = typePart.split("/")[0].toUpperCase();
  
    const params = {};
    if (queryPart) {
      const queryPairs = queryPart.split("&");
  
      queryPairs.forEach((pair) => {
        const [key, value] = pair.split("=");
        if (key && value) {
          const decodedKey = decodeURIComponent(key.trim());
          const decodedValue = value.trim().replace(
            /<\/?[^>]+(>|$)/g,
            "" // Remove any HTML tags
          );
          params[decodedKey] = decodedValue;
        }
      });
    }
  
    return { type, ...params };
  };