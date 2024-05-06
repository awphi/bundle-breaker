import styled from "styled-components";
import React from "react";
// importing a child component
import ChildComponent from "./ChildComponent";
// importing an icon
import { BsArrowThroughHeart } from "react-icons/bs";

// some CSS-in-JS
const Title = styled.h1`
  font-size: 1.5em;
  text-align: center;
  color: #bf4f74;
`;

const Wrapper = styled.section`
  padding: 4em;
  background: papayawhip;
`;

export default function App() {
  const onButtonClick = React.useCallback(async () => {
    // some dynamic imports to force code splitting
    const { default: isEven } = await import("is-even");
    const n = Math.round(Math.random() * 10);
    console.log(`is ${n} even?`, isEven(n));
  }, []);

  // some JSX
  return (
    <Wrapper>
      <BsArrowThroughHeart />
      <Title>Hello World!</Title>
      <button onClick={onButtonClick}>Clicky!</button>
      <ChildComponent></ChildComponent>
    </Wrapper>
  );
}
