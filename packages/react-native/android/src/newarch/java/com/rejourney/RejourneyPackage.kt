/**
 * New Architecture (TurboModules) package registration for Rejourney SDK.
 * 
 * This package is compiled when newArchEnabled=true in gradle.properties.
 * It uses BaseReactPackage for proper TurboModule registration.
 */
package com.rejourney

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class RejourneyPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == RejourneyModuleImpl.NAME) {
            RejourneyModule(reactContext)
        } else {
            null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                RejourneyModuleImpl.NAME to ReactModuleInfo(
                    RejourneyModuleImpl.NAME,      // name
                    RejourneyModule::class.java.name,  // className (full class name)
                    false,  // canOverrideExistingModule
                    false,  // needsEagerInit
                    false,  // isCxxModule - NOT a C++ module
                    true    // isTurboModule - MUST be true for TurboModules
                )
            )
        }
    }
}
