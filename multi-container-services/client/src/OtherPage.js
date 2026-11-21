import React from "react";
import { Link } from "react-router-dom";

// Secondary page demonstrating client-side navigation with React Router.
// Directly refreshing '/otherpage' in production relies on client/nginx/default.conf's try_files rule.
const OtherPage = () => {
  return (
    <div>
      Im some other page!
      <Link to="/">Go back home</Link>
    </div>
  );
};

export default OtherPage;
