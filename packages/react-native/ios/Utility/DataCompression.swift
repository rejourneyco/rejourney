/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation
import zlib

extension Data {
    /// Compress data using gzip
    func gzipCompress() -> Data? {
        return self.withUnsafeBytes { (sourceBytes: UnsafeRawBufferPointer) -> Data? in
            var stream = z_stream()
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: sourceBytes.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uint(self.count)
            stream.total_out = 0
            
            // MAX_WBITS + 16 = gzip format
            if deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, MAX_WBITS + 16, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) != Z_OK {
                return nil
            }
            
            var output = Data(capacity: self.count / 2)
            let chunk = 16384
            
            repeat {
                if Int(stream.total_out) >= output.count {
                    output.count += chunk
                }
                
                output.withUnsafeMutableBytes { (outputBytes: UnsafeMutableRawBufferPointer) in
                    stream.next_out = outputBytes.bindMemory(to: Bytef.self).baseAddress!.advanced(by: Int(stream.total_out))
                    stream.avail_out = uint(outputBytes.count - Int(stream.total_out))
                    
                    deflate(&stream, Z_FINISH)
                }
            } while stream.avail_out == 0
            
            deflateEnd(&stream)
            output.count = Int(stream.total_out)
            return output
        }
    }
}
