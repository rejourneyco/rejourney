/**
 * Old Architecture (Bridge) package registration for Rejourney SDK.
 * 
 * This package is compiled when newArchEnabled=false in gradle.properties.
 * It uses the standard ReactPackage interface for legacy Native Modules.
 */
package com.rejourney

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class RejourneyPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(RejourneyModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
