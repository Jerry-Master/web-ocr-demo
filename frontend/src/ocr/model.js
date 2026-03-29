import * as ort from "onnxruntime-web"

export async function loadModel() {
  return await ort.InferenceSession.create("/model.int8.qdq.onnx", {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  })
}

export async function runModel(session, inputArray) {
  const tensor = new ort.Tensor("float32", inputArray, [1, 1, 28, 28])
  const result = await session.run({ input: tensor })
  const output = result.output.data

  const idx = output.indexOf(Math.max(...output))

  const classes = "0123456789+-=/xy()"
  return classes[idx] || "?"
}