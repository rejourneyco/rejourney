//
//  ModalFlagView.swift
//  CountriesSwiftUI
//
//  Created by Alexey Naumov on 26.10.2019.
//  Copyright © 2019 Alexey Naumov. All rights reserved.
//

import SwiftUI
import EnvironmentOverrides

struct ModalFlagView: View {

    let country: DBModel.Country
    @Binding var isDisplayed: Bool
    let inspection = Inspection<Self>()
    
    var body: some View {
        NavigationStack {
            country.flag.map { url in
                HStack {
                    Spacer()
                    ImageView(imageURL: url)
                        .frame(width: 300, height: 200)
                    Spacer()
                }
            }
            .navigationTitle(country.name)
            .toolbar {
                ToolbarItem {
                    closeButton
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            RejourneyExample.trackScreen("Country Flag Modal")
            RejourneyExample.logEvent("country_flag_modal_viewed", properties: [
                "alpha3_code": country.alpha3Code,
                "country_name": country.name
            ])
        }
        .onReceive(inspection.notice) { self.inspection.visit(self, $0) }
        .attachEnvironmentOverridesUnlessMatrix()
    }
    
    private var closeButton: some View {
        Button(action: {
            RejourneyExample.logEvent("country_flag_modal_closed", properties: [
                "alpha3_code": country.alpha3Code
            ])
            self.isDisplayed = false
        }, label: { Text("Close") })
    }
}
