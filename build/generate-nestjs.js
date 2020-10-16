"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNestjsGrpcServiceMethodsDecorator = exports.generateNestjsServiceClient = exports.generateNestjsServiceController = void 0;
const types_1 = require("./types");
const sourceInfo_1 = require("./sourceInfo");
const ts_poet_1 = require("ts-poet");
const utils_1 = require("./utils");
const case_1 = require("./case");
const main_1 = require("./main");
function generateNestjsServiceController(typeMap, fileDesc, sourceInfo, serviceDesc, options) {
    let service = ts_poet_1.InterfaceSpec.create(`${serviceDesc.name}Controller`).addModifiers(ts_poet_1.Modifier.EXPORT);
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
        requestFn = requestFn.addParameter('request', types_1.requestType(typeMap, methodDesc, options));
        // Use metadata as last argument for interface only configuration
        if (options.addGrpcMetadata) {
            requestFn = requestFn.addParameter(options.addNestjsRestParameter ? 'metadata' : 'metadata?', 'Metadata@grpc');
        }
        if (options.addNestjsRestParameter) {
            requestFn = requestFn.addParameter('...rest', 'any');
        }
        // Return observable for interface only configuration, passing returnObservable=true and methodDesc.serverStreaming=true
        if (types_1.isEmptyType(methodDesc.outputType)) {
            requestFn = requestFn.returns(ts_poet_1.TypeNames.anyType('void'));
        }
        else if (options.returnObservable || methodDesc.serverStreaming) {
            requestFn = requestFn.returns(types_1.responseObservable(typeMap, methodDesc, options));
        }
        else {
            // generate nestjs union type
            requestFn = requestFn.returns(ts_poet_1.TypeNames.unionType(types_1.responsePromise(typeMap, methodDesc, options), types_1.responseObservable(typeMap, methodDesc, options), types_1.responseType(typeMap, methodDesc, options)));
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
exports.generateNestjsServiceController = generateNestjsServiceController;
function generateNestjsServiceClient(typeMap, fileDesc, sourceInfo, serviceDesc, options) {
    let service = ts_poet_1.InterfaceSpec.create(`${serviceDesc.name}Client`).addModifiers(ts_poet_1.Modifier.EXPORT);
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
        requestFn = requestFn.addParameter('request', types_1.requestType(typeMap, methodDesc, options));
        // Use metadata as last argument for interface only configuration
        if (options.addGrpcMetadata) {
            requestFn = requestFn.addParameter(options.addNestjsRestParameter ? 'metadata' : 'metadata?', 'Metadata@grpc');
        }
        if (options.addNestjsRestParameter) {
            requestFn = requestFn.addParameter('...rest', 'any');
        }
        // Return observable since nestjs client always returns an Observable
        requestFn = requestFn.returns(types_1.responseObservable(typeMap, methodDesc, options));
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
exports.generateNestjsServiceClient = generateNestjsServiceClient;
function generateNestjsGrpcServiceMethodsDecorator(serviceDesc, options) {
    let grpcServiceDecorator = ts_poet_1.FunctionSpec.create(`${serviceDesc.name}ControllerMethods`).addModifiers(ts_poet_1.Modifier.EXPORT);
    const grpcMethods = serviceDesc.method
        .filter((m) => !m.clientStreaming)
        .map((m) => `'${options.lowerCaseServiceMethods ? case_1.camelCase(m.name) : m.name}'`)
        .join(', ');
    const grpcStreamMethods = serviceDesc.method
        .filter((m) => m.clientStreaming)
        .map((m) => `'${options.lowerCaseServiceMethods ? case_1.camelCase(m.name) : m.name}'`)
        .join(', ');
    const grpcMethodType = ts_poet_1.TypeNames.importedType('GrpcMethod@@nestjs/microservices');
    const grpcStreamMethodType = ts_poet_1.TypeNames.importedType('GrpcStreamMethod@@nestjs/microservices');
    let decoratorFunction = ts_poet_1.FunctionSpec.createCallable().addParameter('constructor', ts_poet_1.TypeNames.typeVariable('Function'));
    // add loop for applying @GrpcMethod decorators to functions
    decoratorFunction = generateGrpcMethodDecoratorLoop(decoratorFunction, serviceDesc, 'grpcMethods', grpcMethods, grpcMethodType);
    // add loop for applying @GrpcStreamMethod decorators to functions
    decoratorFunction = generateGrpcMethodDecoratorLoop(decoratorFunction, serviceDesc, 'grpcStreamMethods', grpcStreamMethods, grpcStreamMethodType);
    const body = ts_poet_1.CodeBlock.empty().add('return function %F', decoratorFunction);
    grpcServiceDecorator = grpcServiceDecorator.addCodeBlock(body);
    return grpcServiceDecorator;
}
exports.generateNestjsGrpcServiceMethodsDecorator = generateNestjsGrpcServiceMethodsDecorator;
function generateGrpcMethodDecoratorLoop(decoratorFunction, serviceDesc, grpcMethodsName, grpcMethods, grpcType) {
    return decoratorFunction
        .addStatement('const %L: string[] = [%L]', grpcMethodsName, grpcMethods)
        .beginControlFlow('for (const method of %L)', grpcMethodsName)
        .addStatement(`const %L: any = %L`, 'descriptor', `Reflect.getOwnPropertyDescriptor(constructor.prototype, method)`)
        .addStatement(`%T('${serviceDesc.name}', method)(constructor.prototype[method], method, descriptor)`, grpcType)
        .endControlFlow();
}
