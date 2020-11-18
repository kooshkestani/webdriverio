import EventEmitter from 'events'
import puppeteer from 'puppeteer-core'

import DevToolsService from '../src'
import Auditor from '../src/auditor'

import logger from '@wdio/logger'

jest.mock('../src/commands', () => {
    class CommandHandlerMock {
        cdp = jest.fn()
    }

    return CommandHandlerMock
})

jest.mock('../src/auditor', () => {
    const updateCommandsMock = jest.fn()
    return class AuditorMock {
        traceEvents: any
        logs: any
        updateCommands = updateCommandsMock

        constructor (traceEvents, logs) {
            this.traceEvents = traceEvents
            this.logs = logs
        }
    }
})

jest.mock('../src/utils', () => {
    const { isBrowserSupported } = jest.requireActual('../src/utils')
    let wasCalled = false

    return {
        findCDPInterface: jest.fn().mockImplementation(() => {
            if (!wasCalled) {
                wasCalled = true
                return 42
            }
            throw new Error('boom')
        }),
        isBrowserSupported,
        setUnsupportedCommand: jest.fn()
    }
})

const pageMock = {
    setCacheEnabled: jest.fn(),
    emulate: jest.fn()
}
const sessionMock = { send: jest.fn() }
const log = logger('')

beforeEach(() => {
    global.browser = {
        getPuppeteer: jest.fn(() => puppeteer.connect({})),
        addCommand: jest.fn(),
        emit: jest.fn()
    } as any

    sessionMock.send.mockClear()
    ;(log.error as jest.Mock).mockClear()
})

test.only('beforeSession', () => {
    const service = new DevToolsService()
    expect(service['_isSupported']).toBe(false)

    service.beforeSession(null, {})
    expect(service['_isSupported']).toBe(false)

    service.beforeSession(null, { browserName: 'firefox' })
    expect(service['_isSupported']).toBe(false)

    service.beforeSession(null, { browserName: 'chrome', version: 62 })
    expect(service['_isSupported']).toBe(false)

    service.beforeSession(null, { browserName: 'chrome', version: 65 })
    expect(service['_isSupported']).toBe(true)
})

test.only('if not supported by browser', async () => {
    const service = new DevToolsService()
    service['_isSupported'] = false

    await service._setupHandler()
    expect(global.browser.addCommand.mock.calls).toHaveLength(0)
})

test.only('if supported by browser', async () => {
    const service = new DevToolsService()
    service['_isSupported'] = true
    await service._setupHandler()
    expect(service['_session'].send).toBeCalledWith('Network.enable')
    expect(service['_session'].send).toBeCalledWith('Console.enable')
    expect(service['_session'].send).toBeCalledWith('Page.enable')
    expect(global.browser.addCommand).toBeCalledWith(
        'enablePerformanceAudits', expect.any(Function))
    expect(global.browser.addCommand).toBeCalledWith(
        'disablePerformanceAudits', expect.any(Function))
    expect(global.browser.addCommand).toBeCalledWith(
        'emulateDevice', expect.any(Function))

    const rawEventListener = service['_puppeteer']['_connection']._transport._ws.addEventListener
    expect(rawEventListener).toBeCalledTimes(1)
    expect(rawEventListener).toBeCalledWith('message', expect.any(Function))

    const rawWsEvent = rawEventListener.mock.calls.pop().pop()
    service['_devtoolsGatherer'] = { onMessage: jest.fn() } as any
    rawWsEvent({ data: '{"method": "foo", "params": "bar"}' })
    expect(service['_devtoolsGatherer'].onMessage).toBeCalledTimes(1)
    expect(service['_devtoolsGatherer'].onMessage).toBeCalledWith({ method:'foo', params: 'bar' })
    expect((global.browser as any).emit).toBeCalledTimes(1)
    expect((global.browser as any).emit).toBeCalledWith('foo', 'bar')
})

test.only('beforeCommand', () => {
    const service = new DevToolsService()
    service['_traceGatherer'] = { startTracing: jest.fn() } as any
    service._setThrottlingProfile = jest.fn()

    service['_networkThrottling'] = 'offline'
    service['_cpuThrottling'] = 2
    service['_cacheEnabled'] = true

    // @ts-ignore test without paramater
    service.beforeCommand()
    expect(service['_traceGatherer'].startTracing).toBeCalledTimes(0)

    service['_shouldRunPerformanceAudits'] = true
    // @ts-ignore test without paramater
    service.beforeCommand()
    expect(service['_traceGatherer'].startTracing).toBeCalledTimes(0)

    // @ts-ignore test with only one paramater
    service.beforeCommand('foobar')
    expect(service['_traceGatherer'].startTracing).toBeCalledTimes(0)

    service.beforeCommand('navigateTo', ['some page'])
    expect(service['_traceGatherer'].startTracing).toBeCalledTimes(1)
    expect(service['_traceGatherer'].startTracing).toBeCalledWith('some page')
    expect(service._setThrottlingProfile).toBeCalledWith('offline', 2, true)

    service.beforeCommand('url', ['next page'])
    expect(service['_traceGatherer'].startTracing).toBeCalledTimes(2)
    expect(service['_traceGatherer'].startTracing).toBeCalledWith('next page')
    expect(service._setThrottlingProfile).toBeCalledWith('offline', 2, true)

    service.beforeCommand('click', ['some other page'])
    expect(service['_traceGatherer'].startTracing).toBeCalledTimes(3)
    expect(service['_traceGatherer'].startTracing).toBeCalledWith('click transition')
})

test.only('afterCommand', () => {
    const service = new DevToolsService()
    service['_traceGatherer'] = { once: jest.fn() } as any

    // @ts-ignore test without paramater
    service.afterCommand()
    expect(service['_traceGatherer'].once).toBeCalledTimes(0)

    // @ts-ignore access mock
    service['_traceGatherer']['isTracing'] = true
    // @ts-ignore test without paramater
    service.afterCommand()
    expect(service['_traceGatherer'].once).toBeCalledTimes(0)

    service.afterCommand('foobar')
    expect(service['_traceGatherer'].once).toBeCalledTimes(0)

    service.afterCommand('navigateTo')
    expect(service['_traceGatherer'].once).toBeCalledTimes(3)

    service.afterCommand('url')
    expect(service['_traceGatherer'].once).toBeCalledTimes(6)

    service.afterCommand('click')
    expect(service['_traceGatherer'].once).toBeCalledTimes(9)
})

test.only('afterCommand: should create a new auditor instance and should update the browser commands', () => {
    const service = new DevToolsService()
    service['_traceGatherer'] = new EventEmitter() as any

    // @ts-ignore access mock
    service['_traceGatherer']['isTracing'] = true
    service['_devtoolsGatherer'] = { getLogs: jest.fn() } as any
    global.browser = 'some browser' as any
    service.afterCommand('url')
    service['_traceGatherer'].emit('tracingComplete', { some: 'events' })

    const auditor = new Auditor()
    expect(auditor.updateCommands).toBeCalledWith('some browser')
})

test.only('afterCommand: should update browser commands even if failed', () => {
    const service = new DevToolsService()
    service['_traceGatherer'] = new EventEmitter() as any

    // @ts-ignore access mock
    service['_traceGatherer']['isTracing'] = true
    service['_devtoolsGatherer'] = { getLogs: jest.fn() } as any
    global.browser = 'some browser' as any
    service.afterCommand('url')
    service['_traceGatherer'].emit('tracingError', new Error('boom'))

    const auditor = new Auditor()
    expect(auditor.updateCommands).toBeCalledWith('some browser', expect.any(Function))
})

test.only('afterCommand: should continue with command after tracingFinished was emitted', async () => {
    const service = new DevToolsService()
    service['_traceGatherer'] = new EventEmitter() as any

    // @ts-ignore access mock
    service['_traceGatherer']['isTracing'] = true
    service._setThrottlingProfile = jest.fn()

    const start = Date.now()
    setTimeout(() => service['_traceGatherer'].emit('tracingFinished'), 100)
    await service.afterCommand('navigateTo')

    expect(Date.now() - start).toBeGreaterThan(98)
    expect(service._setThrottlingProfile).toBeCalledWith('online', 0, true)
})

test.only('_enablePerformanceAudits: throws if network or cpu properties have wrong types', () => {
    const service = new DevToolsService()
    expect(
        () => service._enablePerformanceAudits({ networkThrottling: 'super fast 3g' } as any)
    ).toThrow()
    expect(
        () => service._enablePerformanceAudits({ cpuThrottling: '34' } as any)
    ).toThrow()
})

test.only('_enablePerformanceAudits: applies some default values', () => {
    const service = new DevToolsService()
    service._enablePerformanceAudits()

    expect(service['_networkThrottling']).toBe('Good 3G')
    expect(service['_cpuThrottling']).toBe(4)
    expect(service['_cacheEnabled']).toBe(false)
})

test.only('_enablePerformanceAudits: applies some custom values', () => {
    const service = new DevToolsService()
    service._enablePerformanceAudits({
        networkThrottling: 'Regular 2G',
        cpuThrottling: 42,
        cacheEnabled: true,
    })

    expect(service['_networkThrottling']).toBe('Regular 2G')
    expect(service['_cpuThrottling']).toBe(42)
    expect(service['_cacheEnabled']).toBe(true)
})

test.only('_disablePerformanceAudits', () => {
    const service = new DevToolsService()
    service._enablePerformanceAudits({
        networkThrottling: 'Regular 2G',
        cpuThrottling: 42,
        cacheEnabled: true,
    })
    service._disablePerformanceAudits()
    expect(service['_shouldRunPerformanceAudits']).toBe(false)
})

test.only('_setThrottlingProfile', async () => {
    const service = new DevToolsService()
    service['_page'] = pageMock as any
    service['_session'] = sessionMock as any

    await service._setThrottlingProfile('Good 3G', 4, true)
    expect(pageMock.setCacheEnabled).toBeCalledWith(true)
    expect(sessionMock.send).toBeCalledWith('Emulation.setCPUThrottlingRate', { rate: 4 })
    expect(sessionMock.send).toBeCalledWith('Network.emulateNetworkConditions', {
        downloadThroughput: 188743,
        latency: 562.5,
        offline: false,
        uploadThroughput: 86400
    })
})

test.only('_emulateDevice', async () => {
    const service = new DevToolsService()
    service['_page'] = pageMock as any
    service['_session'] = sessionMock as any
    await service._emulateDevice('Nexus 6P')

    expect(pageMock.emulate.mock.calls).toMatchSnapshot()
    pageMock.emulate.mockClear()
    await service._emulateDevice({ foo: 'bar' } as any)
    expect(pageMock.emulate.mock.calls).toEqual([[{ foo: 'bar' }]])

    const isSuccessful = await service._emulateDevice('not existing').then(
        () => true,
        () => false)
    expect(isSuccessful).toBe(false)
})

test.only('before hook', async () => {
    const service = new DevToolsService()
    service._setupHandler = jest.fn()
    service.before()
    expect(service._setupHandler).toBeCalledTimes(1)
})

test.only('onReload hook', async () => {
    const service = new DevToolsService()
    service._setupHandler = jest.fn()
    ;(global.browser as any).puppeteer = 'suppose to be reset after reload' as any
    service.onReload()
    expect(service._setupHandler).toBeCalledTimes(1)
    expect((global.browser as any).puppeteer).toBeNull()
})

afterEach(() => {
})
