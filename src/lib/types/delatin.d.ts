declare module 'delatin' {
  export default class Delatin {
    coords: number[];
    triangles: number[];
    constructor(data: ArrayLike<number>, width: number, height: number);
    run(maxError: number): void;
    heightAt(x: number, y: number): number;
    getMaxError(): number;
    getRMSD(): number;
  }
}
