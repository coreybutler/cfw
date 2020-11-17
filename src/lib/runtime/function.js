// Referenced from https://github.com/dollarshaveclub/cloudworker/pull/149/files

const FunctionProxy = new Proxy(Function, {
  construct: () => {
    throw new EvalError('Code generation from strings disallowed for this context')
  }
})

export { FunctionProxy as default }
