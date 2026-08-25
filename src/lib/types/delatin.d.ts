declare module 'delatin' {
  export default class Delatin {
    constructor(data: ArrayLike<number>, width: number, height: number);
    run(maxError?: number): void;
    refine(): void;
    getMaxError(): number;
    getRMSD(): number;
    heightAt(x: number, y: number): number;
    coords: number[];
    triangles: number[];
  }
}
