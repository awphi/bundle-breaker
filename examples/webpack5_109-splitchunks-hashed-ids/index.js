import("is-even").then(({ default: isEven }) => {
  console.log("is-even:", isEven, isEven(8));
});
