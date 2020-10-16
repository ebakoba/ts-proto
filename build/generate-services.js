"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDataLoaderOptionsType = exports.generateDataLoadersType = exports.generateRpcType = exports.generateServiceClientImpl = exports.generateService = void 0;
const types_1 = require("./types");
const ts_poet_1 = require("ts-poet");
const utils_1 = require("./utils");
const sourceInfo_1 = require("./sourceInfo");
const case_1 = require("./case");
const main_1 = require("./main");
const dataloader = ts_poet_1.TypeNames.anyType('DataLoader*dataloader');
/**
 * Generates an interface for `serviceDesc`.
 *
 * Some RPC frameworks (i.e. Twirp) can use the same interface, i.e.
 * `getFoo(req): Promise<res>` for the client-side and server-side,
 * which is the intent for this interface.
 *
 * Other RPC frameworks (i.e. NestJS) that need different client-side
 * vs. server-side code/interfaces are handled separately.
 */
function generateService(typeMap, fileDesc, sourceInfo, serviceDesc, options) {
    let service = ts_poet_1.InterfaceSpec.create(serviceDesc.name).addModifiers(ts_poet_1.Modifier.EXPORT);
    if (options.useContext) {
        service = service.addTypeVariable(main_1.contextTypeVar);
    }
    utils_1.maybeAddComment(sourceInfo, (text) => (service = service.addJavadoc(text)));
    serviceDesc.method.forEach((methodDesc, index) => {
        if (options.lowerCaseServiceMethods) {
            methodDesc.name = case_1.camelCase(methodDesc.name);
        }
        let requestFn = ts_poet_1.FunctionSpec.create(methodDesc.name);
        if (options.useContext) {
            requestFn = requestFn.addParameter('ctx', ts_poet_1.TypeNames.typeVariable('Context'));
        }
        const info = sourceInfo.lookup(sourceInfo_1.Fields.service.method, index);
        utils_1.maybeAddComment(info, (text) => (requestFn = requestFn.addJavadoc(text)));
        let inputType = types_1.requestType(typeMap, methodDesc, options);
        // the grpc-web clients `fromPartial` the input before handing off to grpc-web's
        // serde runtime, so it's okay to accept partial results from the client
        if (options.outputClientImpl === 'grpc-web') {
            inputType = ts_poet_1.TypeNames.parameterizedType(ts_poet_1.TypeNames.anyType('DeepPartial'), inputType);
        }
        requestFn = requestFn.addParameter('request', inputType);
        // Use metadata as last argument for interface only configuration
        if (options.outputClientImpl === 'grpc-web') {
            requestFn = requestFn.addParameter('metadata?', 'grpc.Metadata');
        }
        else if (options.addGrpcMetadata) {
            requestFn = requestFn.addParameter(options.addNestjsRestParameter ? 'metadata' : 'metadata?', 'Metadata@grpc');
        }
        if (options.addNestjsRestParameter) {
            requestFn = requestFn.addParameter('...rest', 'any');
        }
        // Return observable for interface only configuration, passing returnObservable=true and methodDesc.serverStreaming=true
        if (options.returnObservable || methodDesc.serverStreaming) {
            requestFn = requestFn.returns(types_1.responseObservable(typeMap, methodDesc, options));
        }
        else {
            requestFn = requestFn.returns(types_1.responsePromise(typeMap, methodDesc, options));
        }
        service = service.addFunction(requestFn);
        if (options.useContext) {
            const batchMethod = types_1.detectBatchMethod(typeMap, fileDesc, serviceDesc, methodDesc, options);
            if (batchMethod) {
                const name = batchMethod.methodDesc.name.replace('Batch', 'Get');
                let batchFn = ts_poet_1.FunctionSpec.create(name);
                if (options.useContext) {
                    batchFn = batchFn.addParameter('ctx', ts_poet_1.TypeNames.typeVariable('Context'));
                }
                batchFn = batchFn.addParameter(utils_1.singular(batchMethod.inputFieldName), batchMethod.inputType);
                batchFn = batchFn.returns(ts_poet_1.TypeNames.PROMISE.param(batchMethod.outputType));
                service = service.addFunction(batchFn);
            }
        }
    });
    return service;
}
exports.generateService = generateService;
function generateRegularRpcMethod(options, typeMap, fileDesc, serviceDesc, methodDesc) {
    let requestFn = ts_poet_1.FunctionSpec.create(methodDesc.name);
    if (options.useContext) {
        requestFn = requestFn.addParameter('ctx', ts_poet_1.TypeNames.typeVariable('Context'));
    }
    let inputType = types_1.requestType(typeMap, methodDesc, options);
    return requestFn
        .addParameter('request', inputType)
        .addStatement('const data = %L.encode(request).finish()', inputType)
        .addStatement('const promise = this.rpc.request(%L"%L.%L", %S, %L)', options.useContext ? 'ctx, ' : '', // sneak ctx in as the 1st parameter to our rpc call
    fileDesc.package, serviceDesc.name, methodDesc.name, 'data')
        .addStatement('return promise.then(data => %L.decode(new %T(data)))', types_1.responseType(typeMap, methodDesc, options), 'Reader@protobufjs/minimal')
        .returns(types_1.responsePromise(typeMap, methodDesc, options));
}
function generateServiceClientImpl(typeMap, fileDesc, serviceDesc, options) {
    // Define the FooServiceImpl class
    let client = ts_poet_1.ClassSpec.create(`${serviceDesc.name}ClientImpl`).addModifiers(ts_poet_1.Modifier.EXPORT);
    if (options.useContext) {
        client = client.addTypeVariable(main_1.contextTypeVar);
        client = client.addInterface(`${serviceDesc.name}<Context>`);
    }
    else {
        client = client.addInterface(serviceDesc.name);
    }
    // Create the constructor(rpc: Rpc)
    const rpcType = options.useContext ? 'Rpc<Context>' : 'Rpc';
    client = client.addFunction(ts_poet_1.FunctionSpec.createConstructor().addParameter('rpc', rpcType).addStatement('this.rpc = rpc'));
    client = client.addProperty('rpc', rpcType, { modifiers: [ts_poet_1.Modifier.PRIVATE, ts_poet_1.Modifier.READONLY] });
    // Create a method for each FooService method
    for (const methodDesc of serviceDesc.method) {
        // See if this this fuzzy matches to a batchable method
        if (options.useContext) {
            const batchMethod = types_1.detectBatchMethod(typeMap, fileDesc, serviceDesc, methodDesc, options);
            if (batchMethod) {
                client = client.addFunction(generateBatchingRpcMethod(typeMap, batchMethod));
            }
        }
        if (options.useContext && methodDesc.name.match(/^Get[A-Z]/)) {
            client = client.addFunction(generateCachingRpcMethod(options, typeMap, fileDesc, serviceDesc, methodDesc));
        }
        else {
            client = client.addFunction(generateRegularRpcMethod(options, typeMap, fileDesc, serviceDesc, methodDesc));
        }
    }
    return client;
}
exports.generateServiceClientImpl = generateServiceClientImpl;
/** We've found a BatchXxx method, create a synthetic GetXxx method that calls it. */
function generateBatchingRpcMethod(typeMap, batchMethod) {
    const { methodDesc, singleMethodName, inputFieldName, inputType, outputFieldName, outputType, mapType, uniqueIdentifier, } = batchMethod;
    // Create the `(keys) => ...` lambda we'll pass to the DataLoader constructor
    let lambda = ts_poet_1.CodeBlock.lambda(inputFieldName) // e.g. keys
        .addStatement('const request = { %L }', inputFieldName);
    if (mapType) {
        // If the return type is a map, lookup each key in the result
        lambda = lambda
            .beginLambda('return this.%L(ctx, request).then(res =>', methodDesc.name)
            .addStatement('return %L.map(key => res.%L[key])', inputFieldName, outputFieldName)
            .endLambda(')');
    }
    else {
        // Otherwise assume they come back in order
        lambda = lambda.addStatement('return this.%L(ctx, request).then(res => res.%L)', methodDesc.name, outputFieldName);
    }
    return ts_poet_1.FunctionSpec.create(singleMethodName)
        .addParameter('ctx', 'Context')
        .addParameter(utils_1.singular(inputFieldName), inputType)
        .addCode('const dl = ctx.getDataLoader(%S, () => {%>\n', uniqueIdentifier)
        .addCode('return new %T<%T, %T>(%L, { cacheKeyFn: %T, ...ctx.rpcDataLoaderOptions });\n', dataloader, inputType, outputType, lambda, ts_poet_1.TypeNames.anyType('hash*object-hash'))
        .addCode('%<});\n')
        .addStatement('return dl.load(%L)', utils_1.singular(inputFieldName))
        .returns(ts_poet_1.TypeNames.PROMISE.param(outputType));
}
/** We're not going to batch, but use DataLoader for per-request caching. */
function generateCachingRpcMethod(options, typeMap, fileDesc, serviceDesc, methodDesc) {
    const inputType = types_1.requestType(typeMap, methodDesc, options);
    const outputType = types_1.responseType(typeMap, methodDesc, options);
    let lambda = ts_poet_1.CodeBlock.lambda('requests')
        .beginLambda('const responses = requests.map(async request =>')
        .addStatement('const data = %L.encode(request).finish()', inputType)
        .addStatement('const response = await this.rpc.request(ctx, "%L.%L", %S, %L)', fileDesc.package, serviceDesc.name, methodDesc.name, 'data')
        .addStatement('return %L.decode(new %T(response))', outputType, 'Reader@protobufjs/minimal')
        .endLambda(')')
        .addStatement('return Promise.all(responses)');
    const uniqueIdentifier = `${fileDesc.package}.${serviceDesc.name}.${methodDesc.name}`;
    return ts_poet_1.FunctionSpec.create(methodDesc.name)
        .addParameter('ctx', 'Context')
        .addParameter('request', inputType)
        .addCode('const dl = ctx.getDataLoader(%S, () => {%>\n', uniqueIdentifier)
        .addCode('return new %T<%T, %T>(%L, { cacheKeyFn: %T, ...ctx.rpcDataLoaderOptions  });\n', dataloader, inputType, outputType, lambda, ts_poet_1.TypeNames.anyType('hash*object-hash'))
        .addCode('%<});\n')
        .addStatement('return dl.load(request)')
        .returns(ts_poet_1.TypeNames.PROMISE.param(outputType));
}
/**
 * Creates an `Rpc.request(service, method, data)` abstraction.
 *
 * This lets clients pass in their own request-promise-ish client.
 *
 * We don't export this because if a project uses multiple `*.proto` files,
 * we don't want our the barrel imports in `index.ts` to have multiple `Rpc`
 * types.
 */
function generateRpcType(options) {
    const data = ts_poet_1.TypeNames.anyType('Uint8Array');
    let fn = ts_poet_1.FunctionSpec.create('request');
    if (options.useContext) {
        fn = fn.addParameter('ctx', 'Context');
    }
    fn = fn
        .addParameter('service', ts_poet_1.TypeNames.STRING)
        .addParameter('method', ts_poet_1.TypeNames.STRING)
        .addParameter('data', data)
        .returns(ts_poet_1.TypeNames.PROMISE.param(data));
    let rpc = ts_poet_1.InterfaceSpec.create('Rpc');
    if (options.useContext) {
        rpc = rpc.addTypeVariable(ts_poet_1.TypeNames.typeVariable('Context'));
    }
    rpc = rpc.addFunction(fn);
    return rpc;
}
exports.generateRpcType = generateRpcType;
function generateDataLoadersType() {
    // TODO Maybe should be a generic `Context.get<T>(id, () => T): T` method
    let fn = ts_poet_1.FunctionSpec.create('getDataLoader')
        .addTypeVariable(ts_poet_1.TypeNames.typeVariable('T'))
        .addParameter('identifier', ts_poet_1.TypeNames.STRING)
        .addParameter('constructorFn', ts_poet_1.TypeNames.lambda2([], ts_poet_1.TypeNames.typeVariable('T')))
        .returns(ts_poet_1.TypeNames.typeVariable('T'));
    return ts_poet_1.InterfaceSpec.create('DataLoaders')
        .addModifiers(ts_poet_1.Modifier.EXPORT)
        .addFunction(fn)
        .addProperty('rpcDataLoaderOptions', 'DataLoaderOptions', { optional: true });
}
exports.generateDataLoadersType = generateDataLoadersType;
function generateDataLoaderOptionsType() {
    return ts_poet_1.InterfaceSpec.create('DataLoaderOptions')
        .addModifiers(ts_poet_1.Modifier.EXPORT)
        .addProperty('cache', 'boolean', { optional: true });
}
exports.generateDataLoaderOptionsType = generateDataLoaderOptionsType;
