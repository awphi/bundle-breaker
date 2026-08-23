import React from "react";
import styled from "styled-components";
import { Allotment } from "allotment";
// importing some CSS directly
import "allotment/dist/style.css";

import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

const options = {
  title: {
    text: "My chart",
  },
  series: [
    {
      data: [1, 2, 3],
    },
  ],
};

const Wrapper = styled.div`
  height: 500px;
`;

export default function ChildComponent() {
  // using some external react libraries
  return (
    <Wrapper>
      <Allotment>
        <Allotment.Pane minSize={200}>
          <h1>Pane1</h1>
        </Allotment.Pane>
        <Allotment.Pane snap>
          <HighchartsReact highcharts={Highcharts} options={options} />
        </Allotment.Pane>
      </Allotment>
    </Wrapper>
  );
}
