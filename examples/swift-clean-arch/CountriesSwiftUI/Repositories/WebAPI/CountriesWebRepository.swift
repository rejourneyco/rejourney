//
//  CountriesWebRepository.swift
//  CountriesSwiftUI
//
//  Created by Alexey on 7/11/24.
//  Copyright © 2024 Alexey Naumov. All rights reserved.
//

import Foundation

protocol CountriesWebRepository: WebRepository {
    func countries() async throws -> [ApiModel.Country]
    func details(country: DBModel.Country) async throws -> ApiModel.CountryDetails
}

struct RealCountriesWebRepository: CountriesWebRepository {

    let session: URLSession
    let baseURL: String

    init(session: URLSession) {
        self.session = session
        self.baseURL = "https://api.restcountries.com/countries/v5"
    }

    func countries() async throws -> [ApiModel.Country] {
        let response: RESTCountriesV5.Response = try await call(endpoint: API.allCountries)
        return response.data.objects.map { $0.countryModel }
    }

    func details(country: DBModel.Country) async throws -> ApiModel.CountryDetails {
        let response: RESTCountriesV5.Response = try await call(
            endpoint: API.countryDetails(countryName: country.name)
        )
        guard let details = response.data.objects.first else {
            throw APIError.unexpectedResponse
        }
        return details.detailsModel
    }
}

// MARK: - Endpoints

extension RealCountriesWebRepository {
    enum API {
        case allCountries
        case countryDetails(countryName: String)
    }
}

extension RealCountriesWebRepository.API: APICall {
    var path: String {
        switch self {
        case .allCountries:
            return "?response_fields=names,codes.alpha_3,flag.url_png,population&limit=100"
        case let .countryDetails(countryName):
            var allowed = CharacterSet.urlPathAllowed
            allowed.remove(charactersIn: "/")
            let encodedName = countryName.addingPercentEncoding(withAllowedCharacters: allowed)
            return "/names.common/\(encodedName ?? countryName)"
        }
    }
    var method: String {
        switch self {
        case .allCountries, .countryDetails:
            return "GET"
        }
    }
    var headers: [String: String]? {
        return [
            "Accept": "application/json",
            // Public, account-free key documented for live example requests.
            "Authorization": "Bearer rc_live_demo"
        ]
    }
    func body() throws -> Data? {
        return nil
    }
}

// MARK: - REST Countries v5 wire format

enum RESTCountriesV5 {
    struct Response: Codable {
        let data: DataContainer

        init(objects: [Country]) {
            data = DataContainer(objects: objects)
        }
    }

    struct DataContainer: Codable {
        let objects: [Country]
    }

    struct Country: Codable {
        let names: Names
        let codes: Codes
        let capitals: [Capital]?
        let currencies: [ApiModel.Currency]?
        let borders: [String]?
        let flag: Flag
        let population: Int

        var countryModel: ApiModel.Country {
            var localizedNames: [String: String?] = [:]
            for (identifier, translation) in names.translations ?? [:] {
                let languageCode = Locale(identifier: identifier).language.languageCode?.identifier ?? identifier
                localizedNames[languageCode] = translation.common
            }
            return ApiModel.Country(
                name: names.common,
                translations: localizedNames,
                population: population,
                flag: flag.urlPNG.isEmpty ? nil : URL(string: flag.urlPNG),
                alpha3Code: codes.alpha3
            )
        }

        var detailsModel: ApiModel.CountryDetails {
            let capital = capitals?.first(where: { $0.attributes?.primary == true })?.name
                ?? capitals?.first?.name
                ?? ""
            return ApiModel.CountryDetails(
                capital: capital,
                currencies: currencies ?? [],
                borders: borders
            )
        }

        init(country: ApiModel.Country, details: ApiModel.CountryDetails? = nil) {
            names = Names(
                common: country.name,
                translations: country.translations.reduce(into: [:]) { result, item in
                    if let value = item.value {
                        result[item.key] = Translation(common: value)
                    }
                }
            )
            codes = Codes(alpha3: country.alpha3Code)
            capitals = details.map { [Capital(name: $0.capital, attributes: .init(primary: true))] }
            currencies = details?.currencies
            borders = details?.borders
            flag = Flag(urlPNG: country.flag?.absoluteString ?? "")
            population = country.population
        }
    }

    struct Names: Codable {
        let common: String
        let translations: [String: Translation]?
    }

    struct Translation: Codable {
        let common: String
    }

    struct Codes: Codable {
        let alpha3: String

        enum CodingKeys: String, CodingKey {
            case alpha3 = "alpha_3"
        }
    }

    struct Capital: Codable {
        let name: String
        let attributes: Attributes?

        struct Attributes: Codable {
            let primary: Bool?
        }
    }

    struct Flag: Codable {
        let urlPNG: String

        enum CodingKeys: String, CodingKey {
            case urlPNG = "url_png"
        }
    }
}
